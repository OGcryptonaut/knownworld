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
import { RunLog, type LogLine } from '@/components/onboarding/RunLog';
import { appendLog, logLine } from '@/components/onboarding/RunLog';
import { HistoryRail, type RequestThread } from '@/components/requests/HistoryRail';
import { JobsResult } from '@/components/requests/JobsResult';
import { PeopleResult } from '@/components/requests/PeopleResult';
import { IntroResult } from '@/components/requests/IntroResult';
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
  if (r.result.kind === 'intro') return r.result.message ? 'intro drafted' : 'person not found';
  return r.result.kind === 'jobs'
    ? `${r.result.postings.length} postings`
    : `${r.result.matches.length} matches`;
}

/** One agent answer inside the chat: interpretation up top, the payload
 *  collapsible — old answers fold away, the latest one arrives open. */
function AgentAnswer({
  request,
  isLatest,
  running,
}: {
  request: UserRequest;
  isLatest: boolean;
  running: { lines: LogLine[]; stage: Stage } | null;
}) {
  const [open, setOpen] = useState(isLatest);
  useEffect(() => setOpen(isLatest), [isLatest, request.status]);

  if (running) {
    const pct = STAGE_PCT[running.stage];
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>
            {running.stage === 'planning' || running.stage === 'sent'
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
        <RunLog lines={running.lines} emptyText="Waiting for the first step…" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {request.intent && <IntentChip intent={request.intent} />}
        <StatusChip status={request.status} />
        <span className="ml-auto text-[11px] tabular-nums text-slate-500">
          {relTime(request.created_at)}
        </span>
      </div>
      {request.note && <p className="text-sm italic text-slate-400">{request.note}</p>}

      {request.status === 'rejected' && (
        <div className="rounded-lg border border-amber-800/70 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
          The model&apos;s answer failed validation and was rejected. Nothing was stored, ask
          again.
          {request.rejected_reasons.length > 0 && (
            <ul className="mt-1.5 list-inside list-disc text-xs text-amber-200/90">
              {request.rejected_reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {request.status === 'error' && (
        <p className="rounded-lg border border-rose-900/70 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">
          Request failed: {request.error ?? 'unknown error'}
        </p>
      )}

      {request.status === 'done' && request.result && (
        <>
          {!open ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="self-start rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-emerald-700 hover:text-emerald-300"
            >
              Show {resultLabel(request)}
            </button>
          ) : (
            <>
              {!isLatest && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="self-start rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:border-slate-500"
                >
                  Hide results
                </button>
              )}
              {request.result.kind === 'jobs' ? (
                <JobsResult result={request.result} />
              ) : request.result.kind === 'people' ? (
                <PeopleResult result={request.result} />
              ) : (
                <IntroResult result={request.result} />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export default function RequestsPage() {
  const [state, setState] = useState<LoadState>('loading');
  const [requests, setRequests] = useState<UserRequest[]>([]);
  const [peopleCount, setPeopleCount] = useState<number | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
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

  // in-thread suggestion chips: iteration is the point, and the chat can
  // also draft an intro to someone the last answer surfaced
  const followUpSuggestions = useMemo(() => {
    const out: { label: string; query: string }[] = [];
    if (!latest) return out;
    if (latest.status === 'done') {
      out.push({ label: 'Run it again', query: latest.query });
      out.push({
        label: 'More results, dig deeper',
        query: 'Dig deeper and give more results than last time on the same question.',
      });
      const r = latest.result;
      let introName: string | null = null;
      if (r?.kind === 'people' && r.matches[0]) introName = r.matches[0].name;
      if (r?.kind === 'jobs') {
        const withContact = r.postings.find((p) => p.contacts.length > 0);
        introName = withContact?.contacts[0]?.name ?? null;
      }
      if (introName && introName.trim() !== '') {
        out.push({
          label: `Draft an intro to ${introName.split(' ')[0]}`,
          query: `Draft an intro to ${introName} about this.`,
        });
      }
    }
    return out;
  }, [latest]);

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
      <div className="mx-auto mt-12 max-w-md rounded-lg border border-slate-800 glass p-8 text-center">
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
      <div className="mx-auto mt-12 max-w-md rounded-lg border border-slate-800 glass p-8 text-center">
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
            if (!running) setLines([]);
          }}
          onNew={() => {
            setSelectedThreadId(null);
            if (!running) setLines([]);
          }}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="rounded-lg border border-slate-800 glass p-5">
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
              {followUpMode &&
                followUpSuggestions.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    disabled={running}
                    onClick={() => void submit(s.query)}
                    className="max-w-full truncate rounded-full border border-slate-700 px-3 py-1 text-left text-xs text-slate-400 transition-colors hover:border-emerald-700 hover:text-emerald-300 disabled:opacity-40"
                  >
                    {s.label}
                  </button>
                ))}
              {followUpMode && (
                <span className="text-[11px] text-slate-500">
                  Earlier answers in this conversation become context.
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
              {/* the conversation as a chat: your question on the right,
                  the agent's answer on the left; old payloads fold away */}
              {threadRequests.map((r) => (
                <div key={r.id} className="flex flex-col gap-3">
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-sm border border-emerald-800/60 bg-emerald-600/15 px-4 py-2.5">
                      <p className="whitespace-pre-wrap break-words text-sm text-slate-100">
                        {r.query}
                      </p>
                      <p className="mt-1 text-right text-[10px] tabular-nums text-slate-500">
                        {relTime(r.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex">
                    <div className="w-full max-w-[95%] rounded-2xl rounded-bl-sm border border-slate-800 glass p-4">
                      <AgentAnswer
                        request={r}
                        isLatest={r.id === latest?.id}
                        running={
                          r.id === latest?.id && r.status === 'running'
                            ? { lines, stage }
                            : null
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
