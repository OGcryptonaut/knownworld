'use client';

// Wizard step 2 — the refine run. Batches are TRANSIENT server-side; only
// distilled rows persist. Run state lives in IndexedDB, so retry after an
// error resumes from completed batches instead of restarting.

import { useEffect, useRef, useState } from 'react';
import type { ActivityEntry } from '@/lib/types';
import { startRefineRun } from '@/lib/refine';
import { DistilledBadge } from '@/components/Badges';

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? '/agents';
const FEED_MAX = 6;
const ADVANCE_DELAY_MS = 1200;

type RunStatus = 'idle' | 'running' | 'done' | 'error';

interface RunProgress {
  completed: number;
  total: number;
  peopleFound: number;
}

function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function statusClass(s: ActivityEntry['status']): string {
  switch (s) {
    case 'ok':
      return 'text-emerald-400';
    case 'rejected':
      return 'text-amber-400';
    default:
      return 'text-rose-400';
  }
}

export function DistillStep({ onDone }: { onDone: () => void }) {
  const [status, setStatus] = useState<RunStatus>('idle');
  const [activity, setActivity] = useState<ActivityEntry[]>([]); // newest first
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // accumulated separately — the activity list is truncated to a compact feed
  const [estCost, setEstCost] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (status !== 'done') return;
    const t = window.setTimeout(onDone, ADVANCE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [status, onDone]);

  const start = async () => {
    if (status === 'running') return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus('running');
    setErrorMsg(null);
    try {
      await startRefineRun({
        agentsUrl: AGENTS_URL,
        signal: ctrl.signal,
        onEvent: (ev) => {
          if (ev.type === 'batch') {
            setEstCost((c) => c + (ev.response.activity.est_cost_usd || 0));
            setActivity((prev) => [ev.response.activity, ...prev].slice(0, FEED_MAX));
            setProgress({
              completed: ev.progress.completedBatches,
              total: ev.progress.totalBatches,
              peopleFound: ev.progress.peopleFound,
            });
          } else if (ev.type === 'done') {
            setStatus('done');
          } else if (ev.type === 'error') {
            setStatus('error');
            setErrorMsg(ev.error);
          }
        },
      });
      setStatus((s) => (s === 'running' ? 'done' : s));
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setStatus('error');
        setErrorMsg(e instanceof Error ? e.message : 'Refine run failed.');
      }
    }
  };

  const pct =
    progress && progress.total > 0 ? Math.min(100, (progress.completed / progress.total) * 100) : 0;

  const feed = activity.slice(0, FEED_MAX);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-sm font-semibold text-slate-100">Distill with Gemini</h2>
        <p className="mt-1 text-sm text-slate-400">
          Chats stream to Gemini in ~20-chat batches and come back as distilled contact rows —
          name, company, role, a 2-line summary. Closeness is computed in code, never by the model.
        </p>
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-sky-900/60 bg-sky-950/20 px-4 py-2.5 text-xs text-sky-200">
          <DistilledBadge />
          Batches are transient — messages are never stored server-side. Only distilled rows
          persist.
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void start()}
            disabled={status === 'running' || status === 'done'}
            className="w-full rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
          >
            {status === 'error'
              ? 'Retry (resumes completed batches)'
              : status === 'running'
                ? 'Distilling…'
                : status === 'done'
                  ? 'Done'
                  : 'Start distilling'}
          </button>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-x-5 gap-y-1 text-sm">
            <span className="text-slate-400">
              batches{' '}
              <span className="tabular-nums text-slate-100">
                {progress ? `${progress.completed}/${progress.total}` : '—'}
              </span>
            </span>
            <span className="text-slate-400">
              people{' '}
              <span className="tabular-nums text-slate-100">
                {(progress?.peopleFound ?? 0).toLocaleString()}
              </span>
            </span>
            <span className="text-slate-400">
              est cost <span className="tabular-nums text-slate-100">${estCost.toFixed(4)}</span>
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                status === 'running'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : status === 'error'
                    ? 'bg-rose-500/15 text-rose-300'
                    : status === 'done'
                      ? 'bg-sky-500/15 text-sky-300'
                      : 'bg-slate-800 text-slate-400'
              }`}
            >
              {status}
            </span>
          </div>
        </div>

        {progress && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        {errorMsg && (
          <p className="mt-3 rounded-md border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
            {errorMsg}
          </p>
        )}

        {status === 'done' && (
          <p className="mt-3 text-xs text-emerald-300">
            Distillation complete — moving to research…
          </p>
        )}
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40">
        <h2 className="border-b border-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200">
          Activity
          <span className="ml-2 text-xs font-normal text-slate-500">
            last {FEED_MAX} batches — model · tokens · cost
          </span>
        </h2>
        {feed.length === 0 ? (
          <p className="px-4 py-5 text-sm text-slate-500">
            No batches yet — start the run to see live telemetry.
          </p>
        ) : (
          <ul className="divide-y divide-slate-900">
            {feed.map((a, i) => (
              <li
                key={`${a.run_id}-${a.batch_index ?? 'x'}-${i}`}
                title={a.detail}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs sm:px-4"
              >
                <span className="w-14 shrink-0 tabular-nums text-slate-500">
                  batch {a.batch_index ?? '—'}
                </span>
                <span className="max-w-[120px] truncate font-mono text-slate-400 sm:max-w-[200px]">
                  {a.model}
                </span>
                <span className="ml-auto whitespace-nowrap tabular-nums text-slate-300">
                  {a.input_tokens.toLocaleString()}
                  <span className="text-slate-600"> / </span>
                  {a.output_tokens.toLocaleString()} tok
                </span>
                <span className="w-16 shrink-0 text-right tabular-nums text-slate-300">
                  ${a.est_cost_usd.toFixed(4)}
                </span>
                <span className="w-12 shrink-0 text-right tabular-nums text-slate-500">
                  {fmtDuration(a.duration_ms)}
                </span>
                <span className={`w-14 shrink-0 text-right font-medium ${statusClass(a.status)}`}>
                  {a.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
