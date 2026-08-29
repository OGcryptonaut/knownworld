// Shared shapes/helpers for the Database views. A DbRow is a distilled person
// plus (optionally) its enrichment card — merged by tg_id, card never mutated
// client-side; only server-side approval writes the DB.

import type { DistilledPerson, EnrichmentCard } from '@/lib/types';

export interface DbRow {
  person: DistilledPerson;
  card?: EnrichmentCard;
}

/** Outcome of POST /enrichments/{tg_id}/correct — 404 means no card to attach to. */
export type CorrectResult =
  | { ok: true }
  | { ok: false; notFound: true }
  | { ok: false; notFound: false; message: string };

/** definite wins; inferred is carried separately so views can style it apart */
export function companyOf(row: DbRow): { name: string | null; inferred: boolean } {
  if (row.person.company_definite) return { name: row.person.company_definite, inferred: false };
  if (row.person.company_inferred) return { name: row.person.company_inferred, inferred: true };
  return { name: null, inferred: false };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function VerdictBadge({ verdict }: { verdict: EnrichmentCard['verdict'] }) {
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

export function StatusChip({ card }: { card?: EnrichmentCard }) {
  if (!card) return <span className="text-slate-600">—</span>;
  if (card.verified_by === 'owner') {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-700 bg-emerald-950/60 px-2 py-0.5 text-[11px] leading-4 whitespace-nowrap text-emerald-300">
        ✓ verified by owner
      </span>
    );
  }
  if (card.status === 'rejected') {
    return (
      <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[11px] leading-4 whitespace-nowrap text-slate-500">
        rejected
      </span>
    );
  }
  return <VerdictBadge verdict={card.verdict} />;
}
