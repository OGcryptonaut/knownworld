'use client';

// D2 — queue server-side enrichment for work-relevant people.
// Nothing new leaves the browser here: the agents service searches with
// name + company only (already-distilled data). Verdicts are computed in
// code server-side and reviewed on /verify — never auto-applied.

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DistilledPerson, EnrichmentCard } from '@/lib/types';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';
import { DistilledBadge, InferredBadge } from '@/components/Badges';
import { ClosenessBar } from '@/components/ClosenessBar';

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? 'http://localhost:8080';
const POLL_MS = 4000;
const TOP_N = 15;

type LoadState = 'loading' | 'ready' | 'offline';

interface StatusCounts {
  pending: number;
  approved: number;
  rejected: number;
}

interface ActiveRun {
  runId: string;
  queued: number;
  /** total cards across all statuses when the run was queued */
  baselineTotal: number;
}

async function fetchStatusCounts(): Promise<StatusCounts> {
  const [pending, approved, rejected] = await Promise.all(
    (['pending', 'approved', 'rejected'] as const).map(async (status) => {
      const res = await fetch(`${AGENTS_URL}/enrichments?status=${status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as EnrichmentCard[];
      return Array.isArray(data) ? data.length : 0;
    }),
  );
  return { pending, approved, rejected };
}

export default function EnrichPage() {
  const { masked } = usePrivacy();
  const [state, setState] = useState<LoadState>('loading');
  const [people, setPeople] = useState<DistilledPerson[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [counts, setCounts] = useState<StatusCounts | null>(null);
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${AGENTS_URL}/people`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DistilledPerson[];
      setPeople(Array.isArray(data) ? data : []);
      setState('ready');
      try {
        setCounts(await fetchStatusCounts());
      } catch {
        /* enrichments endpoint may not have cards yet */
      }
    } catch {
      setState('offline');
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  // Poll per-status counts every ~4s while a run is out.
  useEffect(() => {
    if (!run) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await fetchStatusCounts();
        if (cancelled) return;
        setCounts(next);
        const total = next.pending + next.approved + next.rejected;
        if (total >= run.baselineTotal + run.queued) setRun(null); // run drained
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
  }, [run]);

  const rows = useMemo(
    () =>
      people
        .filter((p) => p.work_relevant)
        .sort((a, b) => b.closeness - a.closeness),
    [people],
  );

  const toggle = (tgId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tgId)) next.delete(tgId);
      else next.add(tgId);
      return next;
    });
  };

  const selectTop15 = () => {
    setSelected(new Set(rows.slice(0, TOP_N).map((p) => p.tg_id)));
  };

  const startRun = async () => {
    setBusy(true);
    setError(null);
    try {
      const body =
        selected.size > 0 ? { tg_ids: Array.from(selected) } : { top: TOP_N };
      const res = await fetch(`${AGENTS_URL}/enrich/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { run_id: string; queued: number };
      const baselineTotal = counts ? counts.pending + counts.approved + counts.rejected : 0;
      setRun({ runId: data.run_id, queued: data.queued, baselineTotal });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'enrich run failed');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'offline') {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center">
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Enrich</h1>
        <DistilledBadge />
        <span className="text-xs text-slate-500">
          Google Search grounding per person — evidence reviewed on Verify
        </span>
      </div>

      <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-300">
        What leaves your browser here: nothing new — enrichment runs server-side using only
        name + company as search queries.
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={selectTop15}
          disabled={rows.length === 0}
          className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-slate-100 disabled:opacity-40"
        >
          Enrich top {TOP_N}
        </button>
        <button
          type="button"
          onClick={() => void startRun()}
          disabled={busy || run !== null || rows.length === 0}
          className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          {run ? 'Run in progress…' : busy ? 'Queuing…' : `Run enrichment (${selected.size > 0 ? `${selected.size} selected` : `top ${TOP_N}`})`}
        </button>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            clear selection
          </button>
        )}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>

      {(run || counts) && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-2.5 text-xs tabular-nums">
          {run && (
            <span className="text-slate-300">
              Run <code className="font-mono text-slate-400">{run.runId}</code> — {run.queued}{' '}
              queued, polling every {POLL_MS / 1000}s…
            </span>
          )}
          {counts && (
            <span className="flex items-center gap-3">
              <span className="text-amber-300">pending {counts.pending}</span>
              <span className="text-emerald-300">approved {counts.approved}</span>
              <span className="text-slate-400">rejected {counts.rejected}</span>
            </span>
          )}
          {counts && counts.pending > 0 && (
            <Link
              href="/verify"
              className="ml-auto rounded-full border border-emerald-700 bg-emerald-950/60 px-3 py-1 text-emerald-300 hover:border-emerald-500"
            >
              Review {counts.pending} pending card{counts.pending === 1 ? '' : 's'} →
            </Link>
          )}
        </div>
      )}

      <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-2 pb-2">
        {state === 'loading' ? (
          <p className="px-2 py-6 text-sm text-slate-500">Loading people…</p>
        ) : rows.length === 0 ? (
          <p className="px-1 py-6 text-sm text-slate-500">
            No work-relevant people yet — run{' '}
            <Link href="/refine" className="text-emerald-400 hover:underline">
              Refine
            </Link>{' '}
            first.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-slate-950">
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="w-8 px-2 py-2 font-medium" aria-label="select" />
                  <th className="px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Company (definite)</th>
                  <th className="px-2 py-2 font-medium">Company (inferred)</th>
                  <th className="px-2 py-2 font-medium">Closeness</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr
                    key={`${p.tg_id}-${p.run_id}`}
                    className={`border-b border-slate-900 align-top hover:bg-slate-900/50 ${
                      i < TOP_N ? '' : 'opacity-80'
                    }`}
                  >
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(p.tg_id)}
                        onChange={() => toggle(p.tg_id)}
                        aria-label={`select ${displayName(p.name, masked)}`}
                        className="h-3.5 w-3.5 accent-emerald-600"
                      />
                    </td>
                    <td className="max-w-[200px] truncate px-2 py-2 text-slate-100">
                      {displayName(p.name, masked)}
                    </td>
                    <td className="max-w-[180px] truncate px-2 py-2 text-slate-200">
                      {p.company_definite ?? <span className="text-slate-600">—</span>}
                    </td>
                    <td className="max-w-[200px] px-2 py-2">
                      {p.company_inferred && p.company_inferred !== p.company_definite ? (
                        <span className="inline-flex items-center gap-1.5 text-amber-300">
                          <span className="max-w-[130px] truncate">{p.company_inferred}</span>
                          <InferredBadge />
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">
                      <ClosenessBar value={p.closeness} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
