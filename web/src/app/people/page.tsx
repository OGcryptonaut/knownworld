'use client';

// Distilled people persisted by the agents service (Firestore) — the ONLY
// thing that ever leaves the browser and is stored. GET {agentsUrl}/people.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DistilledPerson } from '@/lib/types';
import { DistilledBadge } from '@/components/Badges';
import { PeopleTable } from '@/components/PeopleTable';

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? '/agents';

type LoadState = 'loading' | 'ready' | 'offline';

export default function PeoplePage() {
  const [state, setState] = useState<LoadState>('loading');
  const [people, setPeople] = useState<DistilledPerson[]>([]);
  const [workOnly, setWorkOnly] = useState(true);
  const [query, setQuery] = useState('');
  const [sortDesc, setSortDesc] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${AGENTS_URL}/people`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DistilledPerson[];
      setPeople(Array.isArray(data) ? data : []);
      setState('ready');
    } catch {
      setState('offline');
    }
  }, []);

  useEffect(() => {
    // defer to a microtask so the initial 'loading' render commits first
    void Promise.resolve().then(load);
  }, [load]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const dir = sortDesc ? -1 : 1;
    return people
      .filter(
        (p) => (!workOnly || p.work_relevant) && (q === '' || p.name.toLowerCase().includes(q)),
      )
      .sort((a, b) => dir * (a.closeness - b.closeness));
  }, [people, workOnly, query, sortDesc]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">People</h1>
        <DistilledBadge />
        <span className="text-xs text-slate-500">
          distilled rows only, stored in your Firestore, deletable any time
        </span>
      </div>

      {state === 'offline' ? (
        <div className="mx-auto mt-12 max-w-md rounded-lg border border-slate-800 glass p-8 text-center">
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
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setWorkOnly((w) => !w)}
              aria-pressed={workOnly}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                workOnly
                  ? 'border-emerald-700 bg-emerald-950/60 text-emerald-300'
                  : 'border-slate-700 text-slate-400 hover:border-slate-500'
              }`}
            >
              Work-relevant only {workOnly ? '✓' : ''}
            </button>
            <button
              type="button"
              onClick={() => setSortDesc((d) => !d)}
              className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200"
            >
              Closeness {sortDesc ? '▼' : '▲'}
            </button>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search names…"
              className="ml-auto w-56 rounded-md border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
            />
            <span className="text-xs tabular-nums text-slate-500">
              {state === 'loading' ? '…' : `${rows.length.toLocaleString()} shown`}
            </span>
          </div>

          <div className="rounded-lg border border-slate-800 glass px-2 pb-2">
            {state === 'loading' ? (
              <p className="px-2 py-6 text-sm text-slate-500">Loading people…</p>
            ) : (
              <PeopleTable
                people={rows}
                emptyText={
                  people.length === 0
                    ? 'No distilled people yet. Run Refine first.'
                    : 'No people match the current filters.'
                }
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
