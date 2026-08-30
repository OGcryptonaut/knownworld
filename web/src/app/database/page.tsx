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
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';
import { DistilledBadge } from '@/components/Badges';
import { DatabaseTable } from '@/components/database/DatabaseTable';
import { DatabaseMap } from '@/components/database/DatabaseMap';
import { DatabaseGraph } from '@/components/database/DatabaseGraph';
import { DetailPanel } from '@/components/database/DetailPanel';
import {
  matchesSelection,
  VerdictBadge,
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
  return sel.dim === 'company' ? `Company: ${sel.value}` : `City: ${sel.value}`;
}

export default function DatabasePage() {
  const { masked } = usePrivacy();
  const [state, setState] = useState<LoadState>('loading');
  const [people, setPeople] = useState<DistilledPerson[]>([]);
  const [cards, setCards] = useState<EnrichmentCard[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [selection, setSelection] = useState<DbSelection | null>(null);
  // bumped only on selections made outside the table (map/graph/banner) so
  // the table scrolls the row into view without jolting on plain row clicks
  const [revealNonce, setRevealNonce] = useState(0);
  const [pendingOpen, setPendingOpen] = useState(false);
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

  // the one derivation chain: rows → selection-filtered rows → every view
  const visibleRows = useMemo(
    () => (selection ? rows.filter((r) => matchesSelection(r, selection)) : rows),
    [rows, selection],
  );

  const flagged = useMemo(
    () => rows.filter((r) => r.card && r.card.verdict !== 'match' && r.card.verified_by !== 'owner'),
    [rows],
  );

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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Database</h1>
        <DistilledBadge />
        <span className="text-xs text-slate-500">
          distilled rows + verified evidence — one dataset, map to table
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
            Import your chats and let the agents distill them — it takes a few minutes.
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
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <DatabaseMap
              rows={visibleRows}
              onSelect={selectAndReveal}
              onClusterToggle={toggleCluster}
            />
            <DatabaseGraph
              rows={visibleRows}
              selection={selection}
              onSelect={selectAndReveal}
              onHubToggle={toggleHub}
            />
          </div>

          {flagged.length > 0 && (
            <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-amber-300">
                  {flagged.length} contact{flagged.length === 1 ? '' : 's'} need{flagged.length === 1 ? 's' : ''} a look
                  (mismatch or unresolved) — open and Edit to fix
                </span>
                <button
                  type="button"
                  onClick={() => setPendingOpen((o) => !o)}
                  className="rounded-full border border-emerald-800 px-2.5 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-900/60"
                >
                  {pendingOpen ? 'Hide' : 'Show'}
                </button>
              </div>
              {pendingOpen && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {flagged.map((r) => (
                    <button
                      key={r.person.tg_id}
                      type="button"
                      onClick={() => selectAndReveal(r.person.tg_id)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-1 text-[11px] text-slate-200 hover:border-emerald-700"
                    >
                      <span className="max-w-[140px] truncate">
                        {r.person.name.trim() === ''
                          ? '(unnamed)'
                          : displayName(r.person.name, masked)}
                      </span>
                      {r.card && <VerdictBadge verdict={r.card.verdict} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {selection && (
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Filtered
              </span>
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
              <span className="text-[11px] tabular-nums text-slate-500">
                {visibleRows.length} of {rows.length} people — all three views
              </span>
            </div>
          )}

          <DatabaseTable
            rows={visibleRows}
            selectionActive={selection !== null}
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
