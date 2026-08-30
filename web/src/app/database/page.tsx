'use client';

import Link from 'next/link';
// The enriched network on ONE page: map + graph side by side on top, the
// table with inline expanding detail below — all over one merged dataset
// (distilled people + enrichment cards, joined by tg_id). Approvals and
// owner corrections mirror /verify exactly: only explicit user action
// writes the DB, and unflagged mismatch approvals are refused server-side
// (409). Map dots and graph nodes select the person's table row.
//
// Unified selection (adopted from the owner's atlas-crm reference — "hubs
// are selection/drill-down, people are navigation"): one hub/cluster filter
// derived here feeds map, graph AND table, so the three views stay in sync
// by construction. Table facets apply on top of the selection-filtered rows.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DistilledPerson, EnrichmentCard } from '@/lib/types';
import { DistilledBadge } from '@/components/Badges';
import { DatabaseTable } from '@/components/database/DatabaseTable';
import { DatabaseMap } from '@/components/database/DatabaseMap';
import { DatabaseGraph } from '@/components/database/DatabaseGraph';
import { DetailPanel } from '@/components/database/DetailPanel';
import {
  matchesSelection,
  tagsOf,
  type CorrectResult,
  type DbRow,
  type DbSelection,
} from '@/components/database/shared';

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? '/agents';

type LoadState = 'loading' | 'ready' | 'offline';

/** latest card per tg_id; a pending card outranks same-moment siblings */
function pickCard(a: EnrichmentCard, b: EnrichmentCard): EnrichmentCard {
  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? a : b;
  return b.status === 'pending' ? b : a;
}

function selectionLabel(sel: DbSelection): string {
  if (sel.kind === 'cluster') return sel.label;
  if (sel.kind === 'tag') return `tag: ${sel.value}`;
  return sel.dim === 'company' ? `Company: ${sel.value}` : `City: ${sel.value}`;
}

export default function DatabasePage() {
  const [state, setState] = useState<LoadState>('loading');
  const [people, setPeople] = useState<DistilledPerson[]>([]);
  const [cards, setCards] = useState<EnrichmentCard[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [selection, setSelection] = useState<DbSelection | null>(null);
  // top-bar facets (atlas-crm chain: search+facets first, selection second,
  // and EVERY view — map, graph, table — consumes the same filtered rows)
  const [query, setQuery] = useState('');
  const [workOnly, setWorkOnly] = useState(true);
  // bumped only on selections made outside the table (map/graph/banner) so
  // the table scrolls the row into view without jolting on plain row clicks
  const [revealNonce, setRevealNonce] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [peopleRes, cardsRes] = await Promise.all([
        fetch(`${AGENTS_URL}/people`),
        fetch(`${AGENTS_URL}/enrichments`),
      ]);
      if (!peopleRes.ok) throw new Error(`HTTP ${peopleRes.status}`);
      if (!cardsRes.ok) throw new Error(`HTTP ${cardsRes.status}`);
      const peopleData = (await peopleRes.json()) as DistilledPerson[];
      const cardsData = (await cardsRes.json()) as EnrichmentCard[];
      setPeople(Array.isArray(peopleData) ? peopleData : []);
      setCards(Array.isArray(cardsData) ? cardsData : []);
      setState('ready');
    } catch {
      setState('offline');
    }
  }, []);

  useEffect(() => {
    // defer to a microtask so the initial 'loading' render commits first
    void Promise.resolve().then(load);
  }, [load]);

  const rows = useMemo<DbRow[]>(() => {
    const byId = new Map<number, EnrichmentCard>();
    for (const card of cards) {
      const existing = byId.get(card.tg_id);
      byId.set(card.tg_id, existing ? pickCard(existing, card) : card);
    }
    return people.map((person) => ({ person, card: byId.get(person.tg_id) }));
  }, [people, cards]);

  // the one derivation chain: rows → facets (search + work toggle) →
  // selection → every view. Two stages, exactly like the atlas reference.
  const facetFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (workOnly && !r.person.work_relevant) return false;
      if (q === '') return true;
      return [
        r.person.name,
        r.person.company_definite ?? '',
        r.person.company_inferred ?? '',
        r.person.role_guess ?? '',
        r.card?.location ?? '',
        r.person.summary,
        r.person.owner_note ?? '',
        tagsOf(r).join(' '),
      ]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [rows, query, workOnly]);

  const visibleRows = useMemo(
    () => (selection ? facetFiltered.filter((r) => matchesSelection(r, selection)) : facetFiltered),
    [facetFiltered, selection],
  );

  // the expanded row must stay expandable even when filters would hide it
  const tableRows = useMemo(() => {
    if (selected === null || visibleRows.some((r) => r.person.tg_id === selected)) {
      return visibleRows;
    }
    const row = rows.find((r) => r.person.tg_id === selected);
    return row ? [...visibleRows, row] : visibleRows;
  }, [visibleRows, rows, selected]);

  // closed-vocabulary tag facets over the WHOLE dataset (stable chips),
  // most common first — the atlas top-bar pattern
  const tagFacets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      for (const t of tagsOf(r)) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [rows]);

  const toggle = useCallback((tgId: number) => {
    setActionError(null);
    setSelected((s) => (s === tgId ? null : tgId));
  }, []);

  const selectAndReveal = useCallback(
    (tgId: number) => {
      setActionError(null);
      // a reveal must land on a visible row — drop a selection hiding the target
      setSelection((s) => {
        if (!s) return s;
        const row = rows.find((r) => r.person.tg_id === tgId);
        return row && matchesSelection(row, s) ? s : null;
      });
      setSelected(tgId);
      setRevealNonce((n) => n + 1);
    },
    [rows],
  );

  // clicking the same hub again clears it (toggle)
  const toggleHub = useCallback((dim: 'company' | 'city', value: string) => {
    setSelection((s) =>
      s?.kind === 'hub' && s.dim === dim && s.value === value
        ? null
        : { kind: 'hub', dim, value },
    );
  }, []);

  // ids arrive sorted from the map, so same-cluster re-clicks compare equal
  const toggleCluster = useCallback((ids: number[], label: string) => {
    setSelection((s) =>
      s?.kind === 'cluster' && s.ids.length === ids.length && s.ids.every((v, i) => v === ids[i])
        ? null
        : { kind: 'cluster', label, ids },
    );
  }, []);

  const toggleTag = useCallback((value: string) => {
    setSelection((s) => (s?.kind === 'tag' && s.value === value ? null : { kind: 'tag', value }));
  }, []);

  // owner correction — definitive server-side; 404 = no research card yet
  const correct = useCallback(
    async (tgId: number, corrections: Record<string, string>): Promise<CorrectResult> => {
      try {
        const res = await fetch(`${AGENTS_URL}/enrichments/${tgId}/correct`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corrections),
        });
        if (res.status === 404) return { ok: false, notFound: true };
        if (!res.ok) return { ok: false, notFound: false, message: `HTTP ${res.status}` };
        await load();
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          notFound: false,
          message: e instanceof Error ? e.message : 'network error',
        };
      }
    },
    [load],
  );

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Database</h1>
        <DistilledBadge />
        <span className="text-xs text-slate-500">
          your distilled contacts with verified evidence. One dataset, from map to table
        </span>
        <span className="ml-auto text-xs tabular-nums text-slate-500">
          {state === 'loading' ? '…' : `${rows.length.toLocaleString()} people`}
        </span>
      </div>

      {state === 'offline' ? (
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
      ) : state === 'loading' ? (
        <p className="px-1 py-6 text-sm text-slate-500">Loading database…</p>
      ) : rows.length === 0 ? (
        <div className="mx-auto mt-12 max-w-md rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-300">No database yet</p>
          <p className="mt-1 text-xs text-slate-500">
            Import your chats and let the agents distill them. It takes a few minutes.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Start onboarding →
          </Link>
        </div>
      ) : (
        <>
          {/* the atlas-style top bar: search first, then the closed-vocabulary
              tag chips; every control feeds the ONE derivation chain that
              map, graph and table all consume */}
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, company, role, city, notes…"
                className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none sm:w-80"
              />
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
              {selection && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-700 bg-emerald-950/60 px-3 py-1 text-xs text-emerald-300">
                  {selectionLabel(selection)}
                  <button
                    type="button"
                    aria-label="Clear selection"
                    onClick={() => setSelection(null)}
                    className="-mr-1 rounded-full px-1 leading-none text-emerald-400 hover:bg-emerald-900/70 hover:text-emerald-100"
                  >
                    ×
                  </button>
                </span>
              )}
              <span className="ml-auto text-xs tabular-nums text-slate-500">
                {visibleRows.length} of {rows.length} shown
              </span>
            </div>
            {tagFacets.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {tagFacets.map(([tag, count]) => {
                  const active = selection?.kind === 'tag' && selection.value === tag;
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      aria-pressed={active}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                        active
                          ? 'border-emerald-600 bg-emerald-950/70 text-emerald-300'
                          : 'border-slate-700/80 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                      }`}
                    >
                      {tag}
                      <span className="opacity-50">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <DatabaseMap
              rows={visibleRows}
              onSelect={selectAndReveal}
              onCityToggle={(city) => toggleHub('city', city)}
              onClusterToggle={toggleCluster}
            />
            <DatabaseGraph
              rows={visibleRows}
              selection={selection}
              onSelect={selectAndReveal}
              onHubToggle={toggleHub}
            />
          </div>

          <DatabaseTable
            rows={tableRows}
            filtersActive={selection !== null || query.trim() !== '' || workOnly}
            selected={selected}
            revealNonce={revealNonce}
            onToggle={toggle}
            renderDetail={(row) => (
              <DetailPanel row={row} onCorrect={correct} error={actionError} />
            )}
          />
        </>
      )}
    </div>
  );
}
