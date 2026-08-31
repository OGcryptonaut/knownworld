'use client';

// Requests — conversations with your own network. The left rail lists
// THREADS: the first question plus every follow-up asked into it. Selecting
// a thread and hitting Ask continues that conversation (prior answers become
// planner context server-side); "+ New request" starts a fresh one. A
// running ask stays selected and shows a live progress bar + log (fed by
// the request's own activity trail); finished answers offer one-click
// iterations — feeds and the network move, a second pass digs deeper.

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityEntry, RoleFitProfile, UserRequest } from '@/lib/types';
import { DEFAULT_ROLE_FIT } from '@/lib/types';
import { DistilledBadge } from '@/components/Badges';
import { RunLog, appendLog, logLine, type LogLine } from '@/components/onboarding/RunLog';
import { HistoryRail, type RequestThread } from '@/components/requests/HistoryRail';
import { RequestResultView } from '@/components/requests/RequestResultView';
import { IntentChip, relTime, StatusChip } from '@/components/requests/shared';

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? '/agents';
const ROLE_FIT_KEY = 'kw-rolefit';
const ACT_POLL_MS = 1500;
const DOC_POLL_MS = 2500;

type LoadState = 'loading' | 'ready' | 'offline';

const EXAMPLES = [
  'Is there a BD or partnerships job for me? Check postings from the last 30 days',
  "I'm going to an AI conference in San Francisco. Who should I meet there?",
  'Who in my network should I talk to about payments infrastructure?',
];

type Stage = 'sent' | 'planning' | 'executing' | 'done';
const STAGE_PCT: Record<Stage, number> = { sent: 12, planning: 40, executing: 75, done: 100 };

function loadRoleFit(): RoleFitProfile {
  try {
    const raw = window.localStorage.getItem(ROLE_FIT_KEY);
    if (!raw) return DEFAULT_ROLE_FIT;
    const parsed = JSON.parse(raw) as Partial<RoleFitProfile>;
    return {
      targetRoles: Array.isArray(parsed.targetRoles) ? parsed.targetRoles : DEFAULT_ROLE_FIT.targetRoles,
      industries: Array.isArray(parsed.industries) ? parsed.industries : DEFAULT_ROLE_FIT.industries,
      seniority: Array.isArray(parsed.seniority) ? parsed.seniority : DEFAULT_ROLE_FIT.seniority,
      location: typeof parsed.location === 'string' ? parsed.location : DEFAULT_ROLE_FIT.location,
    };
  } catch {
    return DEFAULT_ROLE_FIT;
  }
}

function threadIdOf(r: UserRequest): string {
  return r.thread_id ?? r.id;
}

function resultLabel(r: UserRequest): string {
  if (r.status === 'rejected') return 'rejected';
  if (r.status === 'error') return 'failed';
  if (r.status === 'running') return 'running…';
  if (!r.result) return 'done';
  return r.result.kind === 'jobs'
    ? `${r.result.postings.length} postings`
    : `${r.result.matches.length} matches`;
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export default function RequestsPage() {
  const [state, setState] = useState<LoadState>('loading');
  const [requests, setRequests] = useState<UserRequest[]>([]);
  const [peopleCount, setPeopleCount] = useState<number | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [stage, setStage] = useState<Stage>('done');
  // the id of OUR in-flight ask — its activity trail feeds the live log
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const seenActRef = useRef<Set<string>>(new Set());

  const log = useCallback((...added: LogLine[]) => setLines((prev) => appendLog(prev, added)), []);

  const load = useCallback(async () => {
    try {
      const [reqRes, peopleRes] = await Promise.all([
        fetch(`${AGENTS_URL}/requests`),
        fetch(`${AGENTS_URL}/people`),
      ]);
      if (!reqRes.ok || !peopleRes.ok) throw new Error('offline');
      const data = (await reqRes.json()) as UserRequest[];
      const people = (await peopleRes.json()) as unknown[];
      setRequests(Array.isArray(data) ? data : []);
      setPeopleCount(Array.isArray(people) ? people.length : 0);
      setState('ready');
    } catch {
      setState('offline');
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const threads = useMemo<RequestThread[]>(() => {
    const byThread = new Map<string, UserRequest[]>();
    for (const r of requests) {
      const key = threadIdOf(r);
      const list = byThread.get(key);
      if (list) list.push(r);
      else byThread.set(key, [r]);
    }
    const out: RequestThread[] = [];
    for (const [id, members] of byThread) {
      members.sort((a, b) => a.created_at.localeCompare(b.created_at));
      out.push({ id, root: members[0], latest: members[members.length - 1], count: members.length });
    }
    out.sort((a, b) => b.latest.created_at.localeCompare(a.latest.created_at));
    return out;
  }, [requests]);

  const threadRequests = useMemo(
    () =>
      selectedThreadId === null
        ? []
        : requests
            .filter((r) => threadIdOf(r) === selectedThreadId)
            .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [requests, selectedThreadId],
  );
  const latest = threadRequests[threadRequests.length - 1] ?? null;

  // live log while OUR ask runs: the request's own activity trail (planner /
  // matcher entries carry the request id as run_id)
  useEffect(() => {
    if (!activeRunId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`${AGENTS_URL}/activity?run_id=${activeRunId}`);
        if (!res.ok || cancelled) return;
        const acts = (await res.json()) as ActivityEntry[];
        for (const a of acts) {
          const key = `${a.ts}|${a.agent}|${a.detail ?? ''}`;
          if (seenActRef.current.has(key)) continue;
          seenActRef.current.add(key);
          const text = `${a.agent}: ${a.detail ?? a.status}`;
          if (a.status === 'ok') {
            log(logLine('ok', text));
            if (a.agent === 'planner') {
              setStage('executing');
              if ((a.detail ?? '').includes('intent=jobs')) {
                log(logLine('info', 'scanning your companies’ live job feeds…'));
              } else if ((a.detail ?? '').includes('intent=people')) {
                log(logLine('info', 'ranking your contacts against the question…'));
              }
            }
          } else {
            log(logLine(a.status === 'rejected' ? 'warn' : 'error', text));
          }
        }
      } catch {
        /* transient — keep polling */
      }
    };
    const id = window.setInterval(() => void tick(), ACT_POLL_MS);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [activeRunId, log]);

  // safety net: a running doc from another tab (or a lost POST) polls to done
  const latestId = latest?.id;
  const latestRunning = latest?.status === 'running';
  useEffect(() => {
    if (!latestId || !latestRunning) return;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(`${AGENTS_URL}/requests/${latestId}`);
          if (!res.ok) return;
          const doc = (await res.json()) as UserRequest;
          if (doc.status !== 'running') {
            setRequests((prev) => prev.map((r) => (r.id === doc.id ? doc : r)));
          }
        } catch {
          /* transient */
        }
      })();
    }, DOC_POLL_MS);
    return () => window.clearInterval(timer);
  }, [latestId, latestRunning]);

  const submit = useCallback(
    async (text?: string) => {
      const trimmed = (text ?? query).trim();
      if (trimmed === '' || running) return;
      const id = newId();
      const followUp = selectedThreadId !== null;
      const threadId = followUp ? selectedThreadId : id;

      setRunning(true);
      setError(null);
      setQuery('');
      setLines([]);
      seenActRef.current = new Set();
      setStage('sent');
      setActiveRunId(id);
      // stay ON this conversation: the running ask appears in place at once
      const placeholder: UserRequest = {
        id,
        query: trimmed,
        intent: null,
        note: null,
        params: {},
        status: 'running',
        error: null,
        rejected_reasons: [],
        result: null,
        created_at: new Date().toISOString(),
        finished_at: null,
        thread_id: threadId,
      };
      setRequests((prev) => [placeholder, ...prev]);
      setSelectedThreadId(threadId);
      setExpandedId(null);
      log(logLine('info', followUp ? 'follow-up sent, planning…' : 'request sent, planning…'));
      setStage('planning');

      try {
        const res = await fetch(`${AGENTS_URL}/requests`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: trimmed,
            profile: loadRoleFit(),
            id,
            thread_id: followUp ? threadId : undefined,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const doc = (await res.json()) as UserRequest;
        setRequests((prev) => prev.map((r) => (r.id === id ? doc : r)));
        if (doc.status === 'done') {
          log(logLine('ok', `done: ${resultLabel(doc)}`));
        } else if (doc.status === 'rejected') {
          log(logLine('warn', 'the model’s answer failed validation and was rejected'));
        } else if (doc.status === 'error') {
          log(logLine('error', `failed: ${doc.error ?? 'unknown error'}`));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'request failed';
        log(logLine('error', `could not finish: ${msg}. The run may still land, check the rail.`));
        setError(msg);
        setRequests((prev) => prev.filter((r) => r.id !== id || r.status !== 'running'));
        setQuery((q) => (q.trim() === '' ? trimmed : q));
        void load();
      } finally {
        setStage('done');
        setRunning(false);
        setActiveRunId(null);
      }
    },
    [query, running, selectedThreadId, log, load],
  );

  if (state === 'offline') {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center">
        <p className="text-sm text-slate-300">Agents service offline</p>
        <p className="mt-1 text-xs text-slate-500">
          Could not reach <code className="font-mono">{AGENTS_URL}/requests</code>. Start the ADK
          service, then retry.
        </p>
        <button
          type="button"
          onClick={() => {
            setState('loading');
            void load();
          }}
          className="mt-4 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Retry
        </button>
      </div>
    );
  }

  if (state === 'ready' && peopleCount === 0) {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center">
        <p className="text-sm text-slate-300">No database yet</p>
        <p className="mt-1 text-xs text-slate-500">
          Requests answer from your own contacts. Import your chats first and the agents will
          build the database.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Start onboarding →
        </Link>
      </div>
    );
  }

  const followUpMode = selectedThreadId !== null;
  const pct = STAGE_PCT[stage];

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Requests</h1>
        <DistilledBadge />
        <span className="text-xs text-slate-500">
          ask in plain language, get answers from your own network
        </span>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:gap-6">
        <HistoryRail
          threads={threads}
          selectedThreadId={selectedThreadId}
          loading={state === 'loading'}
          onSelect={(id) => {
            setSelectedThreadId(id);
            setExpandedId(null);
            if (!running) setLines([]);
          }}
          onNew={() => {
            setSelectedThreadId(null);
            setExpandedId(null);
            if (!running) setLines([]);
          }}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit();
              }}
              rows={3}
              placeholder={
                followUpMode
                  ? 'Ask a follow-up in this conversation…'
                  : 'Ask your network anything…'
              }
              className="w-full resize-none rounded-md border border-slate-800 bg-slate-950 px-3 py-2.5 text-base text-slate-100 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
            />
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {!followUpMode &&
                EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setQuery(ex)}
                    className="max-w-full truncate rounded-full border border-slate-700 px-3 py-1 text-left text-xs text-slate-400 transition-colors hover:border-emerald-700 hover:text-emerald-300"
                  >
                    {ex}
                  </button>
                ))}
              {followUpMode && (
                <span className="text-[11px] text-slate-500">
                  Asking here continues this conversation. Earlier answers become context.
                </span>
              )}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={running || query.trim() === ''}
                className="ml-auto inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                {running && (
                  <span
                    aria-hidden
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
                  />
                )}
                {running ? 'Working…' : followUpMode ? 'Ask in this thread' : 'Ask'}
              </button>
            </div>
            <p className="mt-2.5 text-[11px] text-slate-500">
              Requests run against your distilled database only. Job feeds are public ATS boards.
              Ask again anytime, feeds and your network move.
            </p>
            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          </div>

          {selectedThreadId === null ? (
            state === 'ready' &&
            !running && (
              <p className="px-1 text-sm text-slate-500">
                {threads.length === 0
                  ? 'Try one of the examples above, or ask in your own words.'
                  : 'Pick a conversation from the history rail, or ask a new question.'}
              </p>
            )
          ) : (
            <>
              {/* the conversation: earlier asks compact (click to expand),
                  the latest one full — with live progress while it runs */}
              {threadRequests.slice(0, -1).map((r) => (
                <div key={r.id} className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => setExpandedId((cur) => (cur === r.id ? null : r.id))}
                    aria-expanded={expandedId === r.id}
                    className="flex w-full flex-wrap items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-900/30 px-4 py-2.5 text-left hover:border-slate-600"
                  >
                    <span
                      className={`text-xs text-slate-500 transition-transform ${
                        expandedId === r.id ? 'rotate-90 text-emerald-400' : ''
                      }`}
                      aria-hidden
                    >
                      ▸
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
                      {r.query}
                    </span>
                    {r.intent && <IntentChip intent={r.intent} />}
                    <span className="text-xs tabular-nums text-slate-400">{resultLabel(r)}</span>
                    <span className="text-[11px] tabular-nums text-slate-500">
                      {relTime(r.created_at)}
                    </span>
                  </button>
                  {expandedId === r.id && <RequestResultView request={r} />}
                </div>
              ))}

              {latest && latest.status === 'running' ? (
                <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="min-w-0 max-w-full break-words text-base font-semibold text-slate-100">
                      {latest.query}
                    </h2>
                    <StatusChip status="running" />
                  </div>
                  <div className="mt-4">
                    <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                      <span>
                        {stage === 'planning' || stage === 'sent'
                          ? 'planning the request…'
                          : 'searching…'}
                      </span>
                      <span className="tabular-nums">{pct}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full animate-pulse rounded-full bg-emerald-500 transition-[width] duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <RunLog lines={lines} emptyText="Waiting for the first step…" />
                  </div>
                </div>
              ) : (
                latest && (
                  <>
                    {lines.length > 0 && activeRunId === null && (
                      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                        <RunLog lines={lines} />
                      </div>
                    )}
                    <RequestResultView request={latest} />
                    {latest.status === 'done' && !running && (
                      <div className="flex flex-wrap items-center gap-2 px-1">
                        <span className="text-[11px] uppercase tracking-wide text-slate-500">
                          Iterate
                        </span>
                        <button
                          type="button"
                          onClick={() => void submit(latest.query)}
                          className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-emerald-700 hover:text-emerald-300"
                        >
                          Run it again
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void submit(
                              'Dig deeper and give more results than last time on the same question.',
                            )
                          }
                          className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-emerald-700 hover:text-emerald-300"
                        >
                          More results, dig deeper
                        </button>
                        <span className="text-[11px] text-slate-500">
                          A second pass sees the first answer. Feeds and your network move.
                        </span>
                      </div>
                    )}
                  </>
                )
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
