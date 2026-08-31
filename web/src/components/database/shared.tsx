// Shared shapes/helpers for the Database views. A DbRow is a distilled person
// plus (optionally) its enrichment card — merged by tg_id, card never mutated
// client-side; only server-side approval writes the DB. Also home of the
// unified cross-view selection contract (adopted from the owner's atlas-crm
// reference): hubs are selection/drill-down, people are navigation.

import type { DistilledPerson, EnrichmentCard } from '@/lib/types';
import { deriveTags } from '@/lib/tags';

export interface DbRow {
  person: DistilledPerson;
  card?: EnrichmentCard;
}

/** Outcome of POST /enrichments/{tg_id}/correct — 404 means no card to attach to. */
export type CorrectResult =
  | { ok: true }
  | { ok: false; notFound: true }
  | { ok: false; notFound: false; message: string };

/** One cross-view filter: a graph hub (company/city), a map cluster, or a tag. */
export type DbSelection =
  | { kind: 'hub'; dim: 'company' | 'city'; value: string }
  | { kind: 'cluster'; label: string; ids: number[] }
  | { kind: 'tag'; value: string };

/** definite wins; inferred is carried separately so views can style it apart */
export function companyOf(row: DbRow): { name: string | null; inferred: boolean } {
  if (row.person.company_definite) return { name: row.person.company_definite, inferred: false };
  if (row.person.company_inferred) return { name: row.person.company_inferred, inferred: true };
  return { name: null, inferred: false };
}

/**
 * First comma-part of the evidence location. Used by BOTH the graph's cities
 * lens and city selections — the two must extract identically or clicking a
 * city hub would filter to nothing.
 */
export function cityOf(row: DbRow): string | null {
  const loc = row.card?.location ?? null;
  if (!loc) return null;
  const city = loc.split(',')[0].trim();
  return city === '' ? null : city;
}

/** Tags for a row. Research-created canonical tags (on the card) win;
 *  the client-side regex derivation covers not-yet-researched rows only. */
export function tagsOf(row: DbRow): string[] {
  if (row.card?.tags && row.card.tags.length > 0) return row.card.tags;
  return deriveTags([
    row.person.role_guess,
    row.person.why_relevant,
    row.card?.current_focus,
    row.card?.how_useful,
    ...(row.card?.footprint ?? []),
  ]);
}

export function matchesSelection(row: DbRow, sel: DbSelection): boolean {
  if (sel.kind === 'cluster') return sel.ids.includes(row.person.tg_id);
  if (sel.kind === 'tag') return tagsOf(row).includes(sel.value);
  if (sel.dim === 'company') return companyOf(row).name === sel.value;
  return cityOf(row) === sel.value;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// (verdict chips retired from the Database page — the mismatch note inside
// the card is the one place a verdict still speaks to the user)
