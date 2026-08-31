'use client';

// Wizard step 3 — queue the enrich agent for every work-relevant contact.
// Server-side grounded search uses name + company only; verdicts are computed
// in code; findings auto-apply to the database and stay editable inline.
// Progress and the live log are keyed to the run_id: cards report successes,
// the activity trail reports rejections/errors — failed contacts count toward
// completion instead of hanging the step forever.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityEntry, DistilledPerson, EnrichmentCard } from '@/lib/types';
import { DistilledBadge } from '@/components/Badges';
import { RunLog, appendLog, logLine, type LogLine } from './RunLog';

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? '/agents';
const POLL_MS = 4000;
const ADVANCE_DELAY_MS = 1800;

type LoadState = 'loading' | 'ready' | 'offline';

interface VerdictSplit {
  match: number;
  mismatch: number;
  unverified: number;
}

interface ActiveRun {
  runId: string;
  queued: number;
}

function trim(s: string, max = 140): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

async function fetchCards(): Promise<EnrichmentCard[]> {
  const res = await fetch(`${AGENTS_URL}/enrichments`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as EnrichmentCard[];
  return Array.isArray(data) ? data : [];
}

async function fetchRunActivity(runId: string): Promise<ActivityEntry[]> {
  const res = await fetch(`${AGENTS_URL}/activity?run_id=${encodeURIComponent(runId)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as ActivityEntry[];
  return Array.isArray(data) ? data : [];
}

export function ResearchStep({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [state, setState] = useState<LoadState>('loading');
  const [workIds, setWorkIds] = useState<number[]>([]);
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [created, setCreated] = useState(0);
  const [failed, setFailed] = useState(0);
  const [split, setSplit] = useState<VerdictSplit | null>(null);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  // per-run dedupe across poll ticks — reset when a new run starts
  const seenCardsRef = useRef<Set<number>>(new Set());
  const failedKeysRef = useRef<Set<string>>(new Set());

  const log = useCallback(
    (...added: LogLine[]) => setLines((prev) => appendLog(prev, added)),
    [],
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${AGENTS_URL}/people`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DistilledPerson[];
      const people = Array.isArray(data) ? data : [];
      setWorkIds(people.filter((p) => p.work_relevant).map((p) => p.tg_id));
      setState('ready');
    } catch {
      setState('offline');
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  useEffect(() => {
    if (!finished) return;
    const t = window.setTimeout(onDone, ADVANCE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [finished, onDone]);

  // Poll cards + the run's activity trail every ~4s while the run is out.
  useEffect(() => {
    if (!run) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const [cards, activity] = await Promise.all([
          fetchCards(),
          fetchRunActivity(run.runId).catch(() => [] as ActivityEntry[]),
        ]);
        if (cancelled) return;

        const runCards = cards.filter((c) => c.run_id === run.runId);
        const fresh = runCards.filter((c) => !seenCardsRef.current.has(c.tg_id));
        for (const c of fresh) {
          seenCardsRef.current.add(c.tg_id);
          // name goes in `person`, masked at render by privacy display mode
          const person = c.name || c.resolved_name || `tg_id ${c.tg_id}`;
          if (c.verdict === 'match') {
            log(
              logLine(
                'ok',
                `— match` +
                  (c.current_employer ? ` · ${c.current_employer}` : '') +
                  ` · ${c.citations.length} citation(s)`,
                person,
              ),
            );
          } else if (c.verdict === 'possible_mismatch') {
            log(logLine('warn', `— possible mismatch: ${trim(c.verdict_reason)}`, person));
          } else {
            log(
              logLine(
                'info',
                `— unverified${c.verdict_reason ? `: ${trim(c.verdict_reason)}` : ''}`,
                person,
              ),
            );
          }
        }

        // Rejections/errors never produce a card — they only exist in the
        // activity trail. Surface each once and count it toward completion.
        for (const a of activity) {
          if (a.status === 'ok') continue;
          const key = `${a.ts}|${a.status}|${a.detail ?? ''}`;
          if (failedKeysRef.current.has(key)) continue;
          failedKeysRef.current.add(key);
          log(
            a.status === 'rejected'
              ? logLine('warn', `model output rejected: ${a.detail ?? 'no detail'}`)
              : logLine('error', `research error: ${a.detail ?? 'no detail'}`),
          );
        }

        const failedCount = failedKeysRef.current.size;
        setCreated(runCards.length);
        setFailed(failedCount);
        setSplit({
          match: runCards.filter((c) => c.verdict === 'match').length,
          mismatch: runCards.filter((c) => c.verdict === 'possible_mismatch').length,
          unverified: runCards.filter((c) => c.verdict === 'unverified').length,
        });

        if (runCards.length + failedCount >= run.queued) {
          setRun(null);
          if (runCards.length > 0) {
            log(
              logLine(
                'ok',
                `research complete: ${runCards.length} card(s) created` +
                  (failedCount > 0 ? `, ${failedCount} failed` : ''),
              ),
            );
            setFinished(true);
          } else {
            log(logLine('error', `research failed: all ${run.queued} attempt(s) errored`));
            setError('Every research attempt failed. The log says why. Retry, or skip for now.');
          }
        }
      } catch {
        /* transient — keep polling */
      }
    };
    const id = window.setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [run, log]);

  const startResearch = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${AGENTS_URL}/enrich/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_ids: workIds }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { run_id: string; queued: number };
      if (!data.queued || data.queued <= 0) {
        onDone();
        return;
      }
      seenCardsRef.current = new Set();
      failedKeysRef.current = new Set();
      setCreated(0);
      setFailed(0);
      setSplit(null);
      log(logLine('info', `research queued: ${data.queued} contact(s), run ${data.run_id}`));
      setRun({ runId: data.run_id, queued: data.queued });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'enrich run failed';
      log(logLine('error', `could not start research: ${msg}`));
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  if (state === 'offline') {
    return (
      <div className="mx-auto mt-8 max-w-md rounded-lg border border-slate-800 glass p-8 text-center">
        <p className="text-sm text-slate-300">Agents service offline</p>
        <p className="mt-1 text-xs text-slate-500">
          Could not reach <code className="font-mono">{AGENTS_URL}/people</code>. Start the ADK
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

  const done = run ? Math.min(run.queued, created + failed) : 0;
  const pct = run && run.queued > 0 ? Math.min(100, (done / run.queued) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-slate-800 glass p-5">
        <h2 className="text-sm font-semibold text-slate-100">Research your contacts</h2>
        <p className="mt-1 text-sm text-slate-400">
          Now each contact gets looked up on the open web: current company, role, links,
          location. The search query is only ever a name plus a company. Every claim comes with
          its sources, and the match or mismatch verdict is computed in code, not by the model.
          Findings land in your database on their own, and every card stays editable.
        </p>
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-300">
          <DistilledBadge />
          Nothing new leaves your browser at this step. The search runs on the server, over rows
          that are already distilled.
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void startResearch()}
            disabled={
              busy || run !== null || finished || state === 'loading' || workIds.length === 0
            }
            className="w-full rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
          >
            {run
              ? 'Researching…'
              : finished
                ? 'Done'
                : busy
                  ? 'Queuing…'
                  : `Research all work-relevant contacts${
                      state === 'ready' ? ` (${workIds.length})` : ''
                    }`}
          </button>
          {state === 'ready' && workIds.length === 0 && (
            <>
              <span className="text-xs text-slate-500">
                No work-relevant contacts to research yet.
              </span>
              <button
                type="button"
                onClick={onSkip}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-emerald-700 hover:text-emerald-300"
              >
                Continue →
              </button>
            </>
          )}
          {error && <span className="text-xs text-rose-400">{error}</span>}
        </div>

        {run && (
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
              <span>
                researched{' '}
                {failed > 0 && <span className="text-rose-400">· {failed} failed</span>}
              </span>
              <span className="tabular-nums">
                {done} / {run.queued} · {Math.round(pct)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Checked every {POLL_MS / 1000} seconds. The work happens on the server, you can sit
              back.
            </p>
          </div>
        )}

        {split && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">verdicts so far:</span>
            <span className="inline-flex items-center rounded-full border border-emerald-800 bg-emerald-950/50 px-2 py-0.5 text-[11px] leading-4 text-emerald-300">
              ✓ match {split.match}
            </span>
            <span className="inline-flex items-center rounded-full border border-red-800 bg-red-950/60 px-2 py-0.5 text-[11px] leading-4 text-amber-300">
              ⚠ mismatch {split.mismatch}
            </span>
            <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[11px] leading-4 text-slate-400">
              unverified {split.unverified}
            </span>
          </div>
        )}

        {finished && (
          <p className="mt-3 text-xs text-emerald-300">Research done. Moving on…</p>
        )}

        {(lines.length > 0 || run) && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-semibold text-slate-400">
              Run log
              <span className="ml-2 font-normal text-slate-500">
                each contact&apos;s result lands here as it comes in, errors included
              </span>
            </p>
            <RunLog lines={lines} emptyText="Waiting for the first results…" />
          </div>
        )}
      </section>
    </div>
  );
}
