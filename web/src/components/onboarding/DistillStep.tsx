'use client';

// Wizard step 2 — the refine run. Batches are TRANSIENT server-side; only
// distilled rows persist. Run state lives in IndexedDB, so retry after an
// error resumes from completed batches instead of restarting.

import { useEffect, useRef, useState } from 'react';
import { startRefineRun } from '@/lib/refine';
import { DistilledBadge } from '@/components/Badges';
import { RunLog, appendLog, logLine, type LogLine } from './RunLog';

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? '/agents';
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

/** Turn a raw batch failure into plain words plus what to do about it. */
function explainBatchError(error: string): string {
  if (error.includes('HTTP 401') || error.includes('HTTP 403'))
    return 'Your session expired. Sign in again, then hit Retry. Finished batches are safe.';
  if (error.includes('HTTP 429'))
    return 'The model service is asking us to slow down. Wait a minute, then Retry.';
  if (error.includes('HTTP 5'))
    return 'The model service errored. Usually a hiccup. If the same batch keeps failing, the model is refusing that batch of chats; leaving it out is fine, everyone else still gets distilled.';
  if (error.includes('HTTP 4')) return 'The server rejected this request.';
  return 'Could not reach the server. Check your connection and that the service is up, then Retry.';
}

export function DistillStep({ onDone }: { onDone: () => void }) {
  const [status, setStatus] = useState<RunStatus>('idle');
  const [lines, setLines] = useState<LogLine[]>([]);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // accumulated separately — the log is capped, the total must not be
  const [estCost, setEstCost] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (status !== 'done') return;
    const t = window.setTimeout(onDone, ADVANCE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [status, onDone]);

  const log = (...added: LogLine[]) => setLines((prev) => appendLog(prev, added));

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
          if (ev.type === 'start') {
            if (ev.totalBatches === 0) {
              log(logLine('warn', 'no chats with text found, nothing to distill'));
            } else {
              log(
                logLine(
                  'info',
                  `run started: ${ev.totalBatches} batches` +
                    (ev.resumedBatches > 0
                      ? ` (${ev.resumedBatches} already done earlier, picking up from there)`
                      : ''),
                ),
              );
            }
          } else if (ev.type === 'batch') {
            const a = ev.response.activity;
            setEstCost((c) => c + (a.est_cost_usd || 0));
            setProgress({
              completed: ev.progress.completedBatches,
              total: ev.progress.totalBatches,
              peopleFound: ev.progress.peopleFound,
            });
            const rejectedBatch = a.status === 'rejected';
            log(
              logLine(
                rejectedBatch ? 'warn' : 'ok',
                `batch ${ev.progress.completedBatches}/${ev.progress.totalBatches} · ${a.model} · ` +
                  `${a.input_tokens.toLocaleString()}/${a.output_tokens.toLocaleString()} tok · ` +
                  `$${a.est_cost_usd.toFixed(4)} · ${fmtDuration(a.duration_ms)} · ` +
                  (rejectedBatch
                    ? 'rejected: the model answer failed validation, nothing from it was saved'
                    : `${ev.response.people.length} people`),
              ),
              ...ev.response.rejected.map((r) =>
                logLine('warn', `note (batch ${a.batch_index ?? '?'}): ${r.reason}`),
              ),
            );
          } else if (ev.type === 'retry') {
            log(
              logLine(
                'warn',
                `batch ${ev.batchIndex}, try ${ev.attempt} failed (${ev.error}). ` +
                  `Trying again in ${ev.delayMs / 1000}s`,
              ),
            );
          } else if (ev.type === 'batch-failed') {
            log(
              logLine(
                'error',
                `batch ${ev.batchIndex} gave up (${ev.error}). ${explainBatchError(ev.error)} ` +
                  'Skipping it, the rest continue.',
              ),
            );
          } else if (ev.type === 'done') {
            if (ev.state.status === 'paused') {
              log(logLine('info', 'run paused. Progress is saved, Retry picks up where it left off'));
            } else {
              log(
                logLine(
                  'ok',
                  `distillation complete: ${ev.state.peopleFound.toLocaleString()} people distilled`,
                ),
              );
              setStatus('done');
            }
          } else if (ev.type === 'error') {
            const partial = ev.error.match(/^(\d+) of (\d+) batches failed$/);
            const human = partial
              ? `${partial[1]} of ${partial[2]} batches failed and were skipped. Everyone from the other batches is already saved. Retry re-runs only the failed ones; the reasons are in the log.`
              : `${ev.error}. ${explainBatchError(ev.error)}`;
            log(logLine('error', `run stopped: ${human}`));
            setStatus('error');
            setErrorMsg(human);
          }
        },
      });
      setStatus((s) => (s === 'running' ? 'done' : s));
    } catch (e) {
      if (!ctrl.signal.aborted) {
        const msg = e instanceof Error ? e.message : 'the run failed';
        const human = `${msg}. ${explainBatchError(msg)}`;
        log(logLine('error', `run stopped: ${human}`));
        setStatus('error');
        setErrorMsg(human);
      }
    }
  };

  const pct =
    progress && progress.total > 0 ? Math.min(100, (progress.completed / progress.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-slate-800 glass p-5">
        <h2 className="text-sm font-semibold text-slate-100">Distill with Gemini</h2>
        <p className="mt-1 text-sm text-slate-400">
          Your chats go to Gemini in small batches, about 20 at a time. Each batch comes back as
          contact rows: name, company, role, a short summary. Closeness is computed in code, a
          model never scores it.
        </p>
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-sky-900/60 bg-sky-950/20 px-4 py-2.5 text-xs text-sky-200">
          <DistilledBadge />
          The server reads a batch, returns rows, and forgets it. Your messages are never stored
          there. Only the distilled rows are.
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

        {(status === 'running' || progress) && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
              <span>
                {progress
                  ? `batch ${progress.completed} of ${progress.total}`
                  : 'preparing batches…'}
              </span>
              {progress && <span className="tabular-nums">{Math.round(pct)}%</span>}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              {progress ? (
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              ) : (
                <div className="h-full w-1/3 animate-pulse rounded-full bg-emerald-700/50" />
              )}
            </div>
          </div>
        )}

        {errorMsg && (
          <p className="mt-3 rounded-md border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
            {errorMsg}
          </p>
        )}

        {status === 'done' && (
          <p className="mt-3 text-xs text-emerald-300">All batches done. Moving to research…</p>
        )}
      </section>

      <section className="rounded-lg border border-slate-800 glass">
        <h2 className="border-b border-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200">
          Run log
          <span className="ml-2 text-xs font-normal text-slate-500">
            every batch, retry and error shows up here as it happens
          </span>
        </h2>
        <div className="p-3">
          <RunLog
            lines={lines}
            emptyText="Nothing yet. Start the run and every step shows up here."
          />
        </div>
      </section>
    </div>
  );
}
