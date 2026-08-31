'use client';

// Refine run controls + the judging telemetry surface: a live activity log
// (agent, model, tokens, cost, duration, status per batch) and the distilled
// people found so far. Batches are transient server-side.

import { useMemo, useRef, useState } from 'react';
import type { ActivityEntry, DistilledPerson } from '@/lib/types';
import { startRefineRun } from '@/lib/refine';
import { DistilledBadge } from '@/components/Badges';
import { PeopleTable } from '@/components/PeopleTable';

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? '/agents';

type RunStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';

interface RunProgress {
  completed: number;
  total: number;
  peopleFound: number;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleTimeString('en-GB', { hour12: false });
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

export default function RefinePage() {
  const [status, setStatus] = useState<RunStatus>('idle');
  const [activity, setActivity] = useState<ActivityEntry[]>([]); // newest first
  const [people, setPeople] = useState<DistilledPerson[]>([]);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [rejectedTotal, setRejectedTotal] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const estCost = useMemo(
    () => activity.reduce((acc, a) => acc + (a.est_cost_usd || 0), 0),
    [activity],
  );

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
            setActivity((prev) => [ev.response.activity, ...prev]);
            setRejectedTotal((n) => n + ev.response.rejected.length);
            setPeople((prev) => {
              const byId = new Map(prev.map((p) => [p.tg_id, p]));
              for (const p of ev.response.people) byId.set(p.tg_id, p);
              return [...byId.values()].sort((a, b) => b.closeness - a.closeness);
            });
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
      if (ctrl.signal.aborted) {
        setStatus('paused');
      } else {
        setStatus('error');
        setErrorMsg(e instanceof Error ? e.message : 'Refine run failed.');
      }
    }
  };

  const pause = () => {
    abortRef.current?.abort();
    setStatus('paused');
  };

  const startLabel =
    status === 'paused' ? 'Resume' : status === 'done' ? 'Run again' : 'Start refine';

  const pct =
    progress && progress.total > 0 ? Math.min(100, (progress.completed / progress.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Refine</h1>
        <span className="text-xs text-slate-500">
          Gemini structured-output batches · agents service{' '}
          <code className="font-mono text-slate-400">{AGENTS_URL}</code>
        </span>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-sky-900/60 bg-sky-950/20 px-4 py-2.5 text-xs text-sky-200">
        <DistilledBadge />
        Batches are transient. Messages are never stored server-side, only these distilled rows
        persist.
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 glass p-4">
        <button
          type="button"
          onClick={() => void start()}
          disabled={status === 'running'}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {startLabel}
        </button>
        <button
          type="button"
          onClick={pause}
          disabled={status !== 'running'}
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Pause
        </button>

        <div className="ml-auto flex items-center gap-5 text-sm">
          <span className="text-slate-400">
            batches{' '}
            <span className="tabular-nums text-slate-100">
              {progress ? `${progress.completed}/${progress.total}` : '—'}
            </span>
          </span>
          <span className="text-slate-400">
            people{' '}
            <span className="tabular-nums text-slate-100">
              {(progress?.peopleFound ?? people.length).toLocaleString()}
            </span>
          </span>
          {rejectedTotal > 0 && (
            <span className="text-slate-400">
              rejected <span className="tabular-nums text-amber-400">{rejectedTotal}</span>
            </span>
          )}
          <span className="text-slate-400">
            est cost{' '}
            <span className="tabular-nums text-slate-100">${estCost.toFixed(4)}</span>
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

        {progress && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        {errorMsg && (
          <p className="w-full rounded-md border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
            {errorMsg}
          </p>
        )}
      </div>

      <section className="rounded-lg border border-slate-800 glass">
        <h2 className="border-b border-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200">
          Activity log
          <span className="ml-2 text-xs font-normal text-slate-500">
            per-batch telemetry: agent · model · tokens · cost
          </span>
        </h2>
        <div className="max-h-72 overflow-auto">
          {activity.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">
              No batches yet. Start a run to see live telemetry.
            </p>
          ) : (
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-slate-950">
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Agent</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 text-right font-medium">Batch</th>
                  <th className="px-3 py-2 text-right font-medium">Tokens in / out</th>
                  <th className="px-3 py-2 text-right font-medium">Est cost</th>
                  <th className="px-3 py-2 text-right font-medium">Duration</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((a, i) => (
                  <tr
                    key={`${a.run_id}-${a.batch_index ?? 'x'}-${i}`}
                    className="border-b border-slate-900 hover:bg-slate-900/50"
                    title={a.detail}
                  >
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-400">
                      {fmtTime(a.ts)}
                    </td>
                    <td className="px-3 py-1.5 text-slate-200">{a.agent}</td>
                    <td className="max-w-[200px] truncate px-3 py-1.5 font-mono text-xs text-slate-400">
                      {a.model}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">
                      {a.batch_index ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-300">
                      {a.input_tokens.toLocaleString()}
                      <span className="text-slate-600"> / </span>
                      {a.output_tokens.toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">
                      ${a.est_cost_usd.toFixed(4)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">
                      {fmtDuration(a.duration_ms)}
                    </td>
                    <td className={`px-3 py-1.5 text-xs font-medium ${statusClass(a.status)}`}>
                      {a.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 glass">
        <h2 className="border-b border-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200">
          People found so far
          <span className="ml-2 text-xs font-normal tabular-nums text-slate-500">
            {people.length.toLocaleString()} distilled
          </span>
        </h2>
        <div className="px-2 pb-2">
          <PeopleTable
            people={people}
            emptyText="Distilled people appear here as batches complete."
            maxHeightClass="max-h-[420px]"
          />
        </div>
      </section>
    </div>
  );
}
