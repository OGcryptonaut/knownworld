'use client';

// The enriched network on ONE page: map + graph side by side on top, the
// table with inline expanding detail below — all over one merged dataset
// (distilled people + enrichment cards, joined by tg_id). Approvals and
// owner corrections mirror /verify exactly: only explicit user action
// writes the DB, and unflagged mismatch approvals are refused server-side
// (409). Map dots and graph nodes select the person's table row.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DistilledPerson, EnrichmentCard } from '@/lib/types';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';
import { DistilledBadge } from '@/components/Badges';
import { DatabaseTable } from '@/components/database/DatabaseTable';
import { DatabaseMap } from '@/components/database/DatabaseMap';
import { DatabaseGraph } from '@/components/database/DatabaseGraph';
import { DetailPanel } from '@/components/database/DetailPanel';
import { VerdictBadge, type CorrectResult, type DbRow } from '@/components/database/shared';

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? '/agents';

type LoadState = 'loading' | 'ready' | 'offline';

/** latest card per tg_id; a pending card outranks same-moment siblings */
function pickCard(a: EnrichmentCard, b: EnrichmentCard): EnrichmentCard {
  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? a : b;
  return b.status === 'pending' ? b : a;
}

export default function DatabasePage() {
  const { masked } = usePrivacy();
  const [state, setState] = useState<LoadState>('loading');
  const [people, setPeople] = useState<DistilledPerson[]>([]);
  const [cards, setCards] = useState<EnrichmentCard[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  // bumped only on selections made outside the table (map/graph/banner) so
  // the table scrolls the row into view without jolting on plain row clicks
  const [revealNonce, setRevealNonce] = useState(0);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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

  const pending = useMemo(() => rows.filter((r) => r.card?.status === 'pending'), [rows]);

  const toggle = useCallback((tgId: number) => {
    setActionError(null);
    setSelected((s) => (s === tgId ? null : tgId));
  }, []);

  const selectAndReveal = useCallback((tgId: number) => {
    setActionError(null);
    setSelected(tgId);
    setRevealNonce((n) => n + 1);
  }, []);

  const act = useCallback(
    (tgId: number, action: 'approve' | 'reject', body: Record<string, boolean>) => {
      setBusy(true);
      setActionError(null);
      void (async () => {
        try {
          const res = await fetch(`${AGENTS_URL}/enrichments/${tgId}/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            throw new Error(
              res.status === 409
                ? 'refused (409): mismatch approvals need the explicit company choice'
                : `HTTP ${res.status}`,
            );
          }
          await load();
        } catch (e) {
          setActionError(e instanceof Error ? `${action} failed: ${e.message}` : `${action} failed`);
        } finally {
          setBusy(false);
        }
      })();
    },
    [load],
  );

  const approve = useCallback(
    (tgId: number, setDefinite: boolean, applyName: boolean) =>
      act(tgId, 'approve', { set_company_definite: setDefinite, apply_resolved_name: applyName }),
    [act],
  );
  const reject = useCallback((tgId: number) => act(tgId, 'reject', {}), [act]);

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
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <DatabaseMap rows={rows} onSelect={selectAndReveal} />
            <DatabaseGraph rows={rows} onSelect={selectAndReveal} />
          </div>

          {pending.length > 0 && (
            <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-emerald-300">
                  {pending.length} contact{pending.length === 1 ? '' : 's'} researched — review the
                  findings
                </span>
                <button
                  type="button"
                  onClick={() => setPendingOpen((o) => !o)}
                  className="rounded-full border border-emerald-800 px-2.5 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-900/60"
                >
                  {pendingOpen ? 'Hide' : 'Review'}
                </button>
              </div>
              {pendingOpen && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {pending.map((r) => (
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

          <DatabaseTable
            rows={rows}
            selected={selected}
            revealNonce={revealNonce}
            onToggle={toggle}
            renderDetail={(row) => (
              <DetailPanel
                row={row}
                onApprove={approve}
                onReject={reject}
                onCorrect={correct}
                busy={busy}
                error={actionError}
              />
            )}
          />
        </>
      )}
    </div>
  );
}
