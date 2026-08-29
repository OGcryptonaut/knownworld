'use client';

// D2 gate artifact — the review cards. Evidence vs DB, verdict computed in
// code server-side, and ONLY user approval writes the DB. Mismatches never
// auto-merge; approval choices are explicit checkboxes.

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { EnrichmentCard } from '@/lib/types';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';
import { DistilledBadge } from '@/components/Badges';

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? 'http://localhost:8080';

type Tab = 'pending' | 'approved' | 'rejected';
type LoadState = 'loading' | 'ready' | 'offline';

const TABS: Tab[] = ['pending', 'approved', 'rejected'];

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function VerdictBadge({ verdict }: { verdict: EnrichmentCard['verdict'] }) {
  const base =
    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 whitespace-nowrap';
  switch (verdict) {
    case 'match':
      return (
        <span className={`${base} border-emerald-800 bg-emerald-950/50 text-emerald-300`}>
          ✓ match
        </span>
      );
    case 'possible_mismatch':
      return (
        <span className={`${base} border-red-800 bg-red-950/60 font-medium text-amber-300`}>
          ⚠ possible mismatch
        </span>
      );
    default:
      return (
        <span className={`${base} border-slate-700 bg-slate-900/60 text-slate-400`}>
          unverified
        </span>
      );
  }
}

function EvidenceRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <span className="min-w-0 text-slate-200">{children}</span>
    </div>
  );
}

function ReviewCard({
  card,
  masked,
  onApprove,
  onReject,
  onCorrect,
  actionable,
}: {
  card: EnrichmentCard;
  masked: boolean;
  onApprove: (card: EnrichmentCard, setDefinite: boolean, applyName: boolean) => void;
  onReject: (card: EnrichmentCard) => void;
  onCorrect: (card: EnrichmentCard, corrections: Record<string, string>) => void;
  actionable: boolean;
}) {
  const isMatch = card.verdict === 'match';
  const isMismatch = card.verdict === 'possible_mismatch';
  const nameBlank = card.name.trim() === '';
  const canApplyName = card.resolved_name !== null && nameBlank;

  const [setDefinite, setSetDefinite] = useState(isMatch);
  const [applyName, setApplyName] = useState(false);
  const [busy, setBusy] = useState(false);
  // SPEC v1.1 item 5: inline correction — no new pages, no bulk editing
  const [editing, setEditing] = useState(false);
  const [fName, setFName] = useState(card.name || card.resolved_name || '');
  const [fCompany, setFCompany] = useState(card.current_employer ?? card.db_company ?? '');
  const [fRole, setFRole] = useState('');
  const [fLocation, setFLocation] = useState(card.location ?? '');
  const [fLinkedin, setFLinkedin] = useState(card.linkedin_url ?? '');

  return (
    <div
      className={`rounded-lg border bg-slate-900/40 p-4 ${
        isMismatch ? 'border-red-900/70' : 'border-slate-800'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-sm font-medium text-slate-100">
          {nameBlank ? (
            <span className="italic text-slate-400">(unnamed)</span>
          ) : (
            displayName(card.name, masked)
          )}
        </span>
        <span className="font-mono text-xs tabular-nums text-slate-600">tg:{card.tg_id}</span>
        {card.verified_by === 'owner' ? (
          <span className="rounded-full border border-emerald-700 bg-emerald-950/60 px-2 py-0.5 text-[11px] text-emerald-300">
            ✓ verified by owner
          </span>
        ) : (
          <VerdictBadge verdict={card.verdict} />
        )}
      </div>

      {isMismatch && card.verdict_reason && (
        <p className="mt-2 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-amber-200">
          {card.verdict_reason}
        </p>
      )}
      {!isMismatch && card.verdict_reason && (
        <p className="mt-2 text-xs text-slate-500">{card.verdict_reason}</p>
      )}

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-slate-800/80 bg-slate-950/50 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            DB says
          </p>
          <EvidenceRow label="Company">
            {card.db_company ?? <span className="text-slate-600">—</span>}
          </EvidenceRow>
        </div>
        <div className="rounded-md border border-slate-800/80 bg-slate-950/50 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Evidence says
          </p>
          <div className="flex flex-col gap-1.5">
            <EvidenceRow label="Employer">
              {card.current_employer ?? <span className="text-slate-600">—</span>}
            </EvidenceRow>
            <EvidenceRow label="Location">
              {card.location ?? <span className="text-slate-600">—</span>}
            </EvidenceRow>
            <EvidenceRow label="LinkedIn">
              {card.linkedin_url ? (
                <a
                  href={card.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-emerald-400 hover:underline"
                >
                  {hostOf(card.linkedin_url)}
                </a>
              ) : (
                <span className="text-slate-600">—</span>
              )}
            </EvidenceRow>
            {card.resolved_name && (
              <EvidenceRow label="Name found">
                {displayName(card.resolved_name, masked)}
              </EvidenceRow>
            )}
          </div>
        </div>
      </div>

      {card.footprint.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Footprint</p>
          <ul className="mt-1 list-inside list-disc text-xs text-slate-400">
            {card.footprint.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {card.citations.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {card.citations.map((c, i) => (
            <a
              key={i}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              title={c.snippet ?? c.title}
              className="inline-flex max-w-[260px] items-center gap-1.5 rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-1 text-[11px] text-slate-300 hover:border-emerald-700 hover:text-emerald-300"
            >
              <span className="truncate">{c.title}</span>
              <span className="shrink-0 text-slate-600">{hostOf(c.url)}</span>
            </a>
          ))}
        </div>
      )}

      {actionable && (
        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-800/80 pt-3">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={setDefinite}
              onChange={(e) => setSetDefinite(e.target.checked)}
              className="h-3.5 w-3.5 accent-emerald-600"
            />
            set company as definite
          </label>
          {isMismatch && (
            <span className="text-[11px] text-amber-400">
              mismatches never auto-merge — choose explicitly
            </span>
          )}
          {canApplyName && (
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={applyName}
                onChange={(e) => setApplyName(e.target.checked)}
                className="h-3.5 w-3.5 accent-emerald-600"
              />
              apply resolved name
            </label>
          )}
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing((v) => !v)}
              className="rounded-md border border-slate-700 px-3.5 py-1.5 text-xs text-slate-300 hover:border-emerald-700 hover:text-emerald-300 disabled:opacity-40"
            >
              {editing ? 'Cancel' : 'Correct…'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                onApprove(card, setDefinite, canApplyName && applyName);
              }}
              className="rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                onReject(card);
              }}
              className="rounded-md border border-slate-700 px-3.5 py-1.5 text-xs text-slate-300 hover:border-red-800 hover:text-red-300 disabled:opacity-40"
            >
              Reject
            </button>
          </span>
        </div>
      )}

      {actionable && editing && (
        <div className="mt-3 rounded-md border border-emerald-900/60 bg-slate-950/60 p-3">
          <p className="mb-2 text-xs text-slate-400">
            Your correction is definitive: company writes{' '}
            <span className="text-slate-200">company_definite</span>, the row is marked{' '}
            <span className="text-emerald-300">verified by owner</span>, and the{' '}
            {isMismatch ? 'mismatch' : 'unverified/mismatch'} flag clears.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={fName}
              onChange={(e) => setFName(e.target.value)}
              placeholder="name"
              className={`rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-emerald-700 ${
                masked ? 'blur-[3px] focus:blur-none' : ''
              }`}
            />
            <input
              value={fCompany}
              onChange={(e) => setFCompany(e.target.value)}
              placeholder="company"
              className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-emerald-700"
            />
            <input
              value={fRole}
              onChange={(e) => setFRole(e.target.value)}
              placeholder="role"
              className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-emerald-700"
            />
            <input
              value={fLocation}
              onChange={(e) => setFLocation(e.target.value)}
              placeholder="location"
              className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-emerald-700"
            />
            <input
              value={fLinkedin}
              onChange={(e) => setFLinkedin(e.target.value)}
              placeholder="LinkedIn URL"
              className={`rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-emerald-700 sm:col-span-2 ${
                masked ? 'blur-[3px] focus:blur-none' : ''
              }`}
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const corrections: Record<string, string> = {};
              if (fName.trim() && fName.trim() !== card.name) corrections.name = fName.trim();
              if (fCompany.trim()) corrections.company = fCompany.trim();
              if (fRole.trim()) corrections.role = fRole.trim();
              if (fLocation.trim()) corrections.location = fLocation.trim();
              if (fLinkedin.trim()) corrections.linkedin_url = fLinkedin.trim();
              if (Object.keys(corrections).length === 0) return;
              setBusy(true);
              onCorrect(card, corrections);
            }}
            className="mt-2.5 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            Save correction
          </button>
        </div>
      )}
    </div>
  );
}

export default function VerifyPage() {
  const { masked } = usePrivacy();
  const [tab, setTab] = useState<Tab>('pending');
  const [state, setState] = useState<LoadState>('loading');
  const [cards, setCards] = useState<EnrichmentCard[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (status: Tab) => {
    setState('loading');
    try {
      const res = await fetch(`${AGENTS_URL}/enrichments?status=${status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as EnrichmentCard[];
      setCards(Array.isArray(data) ? data : []);
      setState('ready');
    } catch {
      setState('offline');
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load(tab));
  }, [load, tab]);

  // Optimistic: drop the card immediately; roll back by reloading on failure.
  const approve = useCallback(
    (card: EnrichmentCard, setDefinite: boolean, applyName: boolean) => {
      setCards((prev) => prev.filter((c) => c.tg_id !== card.tg_id));
      setError(null);
      void (async () => {
        try {
          const res = await fetch(`${AGENTS_URL}/enrichments/${card.tg_id}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              set_company_definite: setDefinite,
              apply_resolved_name: applyName,
            }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (e) {
          setError(e instanceof Error ? `approve failed: ${e.message}` : 'approve failed');
          void load('pending');
        }
      })();
    },
    [load],
  );

  const correct = useCallback(
    (card: EnrichmentCard, corrections: Record<string, string>) => {
      setCards((prev) => prev.filter((c) => c.tg_id !== card.tg_id));
      setError(null);
      void (async () => {
        try {
          const res = await fetch(`${AGENTS_URL}/enrichments/${card.tg_id}/correct`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(corrections),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (e) {
          setError(e instanceof Error ? `correction failed: ${e.message}` : 'correction failed');
          void load('pending');
        }
      })();
    },
    [load],
  );

  const reject = useCallback(
    (card: EnrichmentCard) => {
      setCards((prev) => prev.filter((c) => c.tg_id !== card.tg_id));
      setError(null);
      void (async () => {
        try {
          const res = await fetch(`${AGENTS_URL}/enrichments/${card.tg_id}/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (e) {
          setError(e instanceof Error ? `reject failed: ${e.message}` : 'reject failed');
          void load('pending');
        }
      })();
    },
    [load],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Verify</h1>
        <DistilledBadge />
        <span className="text-xs text-slate-500">
          verdicts computed in code — your approval writes the DB
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors ${
              tab === t
                ? 'border-emerald-700 bg-emerald-950/60 text-emerald-300'
                : 'border-slate-700 text-slate-400 hover:border-slate-500'
            }`}
          >
            {t}
          </button>
        ))}
        <span className="ml-2 text-xs tabular-nums text-slate-500">
          {state === 'loading' ? '…' : `${cards.length} card${cards.length === 1 ? '' : 's'}`}
        </span>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>

      {state === 'offline' ? (
        <div className="mx-auto mt-12 max-w-md rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-300">Agents service offline</p>
          <p className="mt-1 text-xs text-slate-500">
            Could not reach <code className="font-mono">{AGENTS_URL}/enrichments</code>. Start the
            ADK service, then retry.
          </p>
          <button
            type="button"
            onClick={() => void load(tab)}
            className="mt-4 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Retry
          </button>
        </div>
      ) : state === 'loading' ? (
        <p className="px-1 py-6 text-sm text-slate-500">Loading cards…</p>
      ) : cards.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">No {tab} cards.</p>
          {tab === 'pending' && (
            <p className="mt-1 text-xs text-slate-500">
              Queue people on{' '}
              <Link href="/enrich" className="text-emerald-400 hover:underline">
                Enrich
              </Link>{' '}
              to generate review cards.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((card) => (
            <ReviewCard
              key={`${card.tg_id}-${card.run_id}`}
              card={card}
              masked={masked}
              onApprove={approve}
              onReject={reject}
              onCorrect={correct}
              actionable={tab === 'pending'}
            />
          ))}
        </div>
      )}
    </div>
  );
}
