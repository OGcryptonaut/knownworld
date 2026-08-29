'use client';

// Wizard step 3 — queue the enrich agent for every work-relevant contact.
// Server-side grounded search uses name + company only; verdicts are computed
// in code and reviewed on /verify — approval, never the model, writes the DB.

import { useCallback, useEffect, useState } from 'react';
import type { DistilledPerson, EnrichmentCard } from '@/lib/types';
import { DistilledBadge } from '@/components/Badges';

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? '/agents';
const POLL_MS = 4000;

type LoadState = 'loading' | 'ready' | 'offline';

interface VerdictSplit {
  match: number;
  mismatch: number;
  unverified: number;
}

interface ActiveRun {
  queued: number;
  /** cards existing before the run — progress counts what grows past this */
  baseline: number;
}

async function fetchCards(): Promise<EnrichmentCard[]> {
  const res = await fetch(`${AGENTS_URL}/enrichments`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as EnrichmentCard[];
  return Array.isArray(data) ? data : [];
}

export function ResearchStep({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [state, setState] = useState<LoadState>('loading');
  const [workIds, setWorkIds] = useState<number[]>([]);
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [created, setCreated] = useState(0);
  const [split, setSplit] = useState<VerdictSplit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Poll cards every ~4s while the run is out; advance once it drains.
  useEffect(() => {
    if (!run) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const cards = await fetchCards();
        if (cancelled) return;
        const made = Math.max(0, cards.length - run.baseline);
        setCreated(made);
        setSplit({
          match: cards.filter((c) => c.verdict === 'match').length,
          mismatch: cards.filter((c) => c.verdict === 'possible_mismatch').length,
          unverified: cards.filter((c) => c.verdict === 'unverified').length,
        });
        if (made >= run.queued) {
          setRun(null);
          onDone();
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
  }, [run, onDone]);

  const startResearch = async () => {
    setBusy(true);
    setError(null);
    try {
      let baseline = 0;
      try {
        baseline = (await fetchCards()).length;
      } catch {
        /* no cards yet */
      }
      const res = await fetch(`${AGENTS_URL}/enrich/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_ids: workIds }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { queued: number };
      if (!data.queued || data.queued <= 0) {
        onDone();
        return;
      }
      setCreated(0);
      setRun({ queued: data.queued, baseline });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'enrich run failed');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'offline') {
    return (
      <div className="mx-auto mt-8 max-w-md rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center">
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

  const pct = run && run.queued > 0 ? Math.min(100, (created / run.queued) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-sm font-semibold text-slate-100">Research your contacts</h2>
        <p className="mt-1 text-sm text-slate-400">
          The enrich agent runs a grounded Google Search per contact — using only name + company,
          already-distilled data. Every claim carries citations, and the match / mismatch verdict
          is computed in code, never by the model. Results become review cards: your approval
          writes the database.
        </p>
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-300">
          <DistilledBadge />
          Nothing new leaves your browser here — the search runs server-side on distilled rows.
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void startResearch()}
            disabled={busy || run !== null || state === 'loading' || workIds.length === 0}
            className="rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {run
              ? 'Researching…'
              : busy
                ? 'Queuing…'
                : `Research all work-relevant contacts${
                    state === 'ready' ? ` (${workIds.length})` : ''
                  }`}
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-slate-500 underline decoration-slate-700 underline-offset-2 hover:text-slate-300"
          >
            Skip for now →
          </button>
          {state === 'ready' && workIds.length === 0 && (
            <span className="text-xs text-slate-500">
              No work-relevant contacts yet — skip ahead.
            </span>
          )}
          {error && <span className="text-xs text-rose-400">{error}</span>}
        </div>

        {run && (
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
              <span>cards created</span>
              <span className="tabular-nums">
                {created} / {run.queued}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Polling every {POLL_MS / 1000}s — this runs server-side, feel free to wait.
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
      </section>
    </div>
  );
}
