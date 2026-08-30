'use client';

// Database table — distilled rows joined with enrichment evidence.
// company_definite and company_inferred never merge: inferred stays amber
// with its badge. Clicking a row expands the inline detail panel directly
// under it (accordion); map/graph selections scroll the row into view.
// Rows arrive pre-filtered by the page-wide hub/cluster selection (atlas-crm
// reference); the facets below apply on top of that.

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { EnrichmentCard } from '@/lib/types';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';
import { InferredBadge } from '@/components/Badges';
import { ClosenessBar } from '@/components/ClosenessBar';
import type { DbRow } from './shared';

type VerdictFilter = 'all' | EnrichmentCard['verdict'];

const VERDICT_FILTERS: { key: VerdictFilter; label: string }[] = [
  { key: 'all', label: 'all' },
  { key: 'match', label: '✓ match' },
  { key: 'possible_mismatch', label: '⚠ mismatch' },
  { key: 'unverified', label: 'unverified' },
];

const COLS = 7; // chevron + 6 data columns

/** grid-rows 0fr → 1fr on mount so the accordion opens smoothly at any height */
function Expand({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-200 ease-out ${
        open ? '[grid-template-rows:1fr]' : '[grid-template-rows:0fr]'
      }`}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

export function DatabaseTable({
  rows,
  selectionActive,
  selected,
  revealNonce,
  onToggle,
  renderDetail,
}: {
  rows: DbRow[];
  /** a page-wide hub/cluster selection already filtered `rows` */
  selectionActive: boolean;
  selected: number | null;
  /** bumped on map/graph/banner selections — scrolls the selected row into view */
  revealNonce: number;
  onToggle: (tgId: number) => void;
  renderDetail: (row: DbRow) => ReactNode;
}) {
  const { masked } = usePrivacy();
  const [workOnly, setWorkOnly] = useState(true);
  const [query, setQuery] = useState('');
  const [sortDesc, setSortDesc] = useState(true);
  const [verdict, setVerdict] = useState<VerdictFilter>('all');
  const selectedRowRef = useRef<HTMLTableRowElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const dir = sortDesc ? -1 : 1;
    return rows
      .filter(
        (r) =>
          // the selected row stays visible even when filters would hide it,
          // so map/graph selections always land on an expandable row
          r.person.tg_id === selected ||
          ((!workOnly || r.person.work_relevant) &&
            (q === '' ||
              [
                r.person.name,
                r.person.company_definite ?? '',
                r.person.company_inferred ?? '',
                r.person.role_guess ?? '',
                r.card?.location ?? '',
                r.person.summary,
                r.person.owner_note ?? '',
              ]
                .join(' ')
                .toLowerCase()
                .includes(q)) &&
            (verdict === 'all' || r.card?.verdict === verdict)),
      )
      .sort((a, b) => dir * (a.person.closeness - b.person.closeness));
  }, [rows, workOnly, query, sortDesc, verdict, selected]);

  useEffect(() => {
    if (revealNonce > 0) {
      selectedRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [revealNonce]);

  return (
    <div className="flex flex-col gap-3">
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
        <span className="flex flex-wrap items-center gap-1.5">
          {VERDICT_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setVerdict(f.key)}
              aria-pressed={verdict === f.key}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                verdict === f.key
                  ? 'border-emerald-700 bg-emerald-950/60 text-emerald-300'
                  : 'border-slate-700 text-slate-400 hover:border-slate-500'
              }`}
            >
              {f.label}
            </button>
          ))}
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, company, role, city…"
          className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none sm:ml-auto sm:w-56"
        />
        <span className="text-xs tabular-nums text-slate-500">
          {filtered.length.toLocaleString()} shown
        </span>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-2 pb-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-sm text-slate-500">
            {selectionActive
              ? 'No people match the current selection + filters.'
              : rows.length === 0
                ? 'No people yet. Distill your chats first.'
                : 'No people match the current filters.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-slate-950">
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="w-6 px-2 py-2" aria-label="Expand" />
                  <th className="px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Company</th>
                  <th className="px-2 py-2 font-medium">Role</th>
                  <th className="px-2 py-2 font-medium">Closeness</th>
                  <th className="px-2 py-2 font-medium">Location</th>
                  <th className="px-2 py-2 font-medium">Links</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const { person, card } = row;
                  const expanded = person.tg_id === selected;
                  return (
                    <Fragment key={`${person.tg_id}-${person.run_id}`}>
                      <tr
                        ref={expanded ? selectedRowRef : undefined}
                        onClick={() => onToggle(person.tg_id)}
                        aria-expanded={expanded}
                        className={`cursor-pointer border-b align-top ${
                          expanded
                            ? 'border-transparent bg-slate-900/60'
                            : 'border-slate-900 hover:bg-slate-900/50'
                        }`}
                      >
                        <td className="px-2 py-2">
                          <span
                            className={`inline-block text-xs text-slate-500 transition-transform duration-200 ${
                              expanded ? 'rotate-90 text-emerald-400' : ''
                            }`}
                            aria-hidden="true"
                          >
                            ▸
                          </span>
                        </td>
                        <td className="max-w-[200px] px-2 py-2 text-slate-100">
                          {person.name.trim() === '' ? (
                            <span className="italic text-slate-400">(unnamed)</span>
                          ) : (
                            <span className="block truncate">
                              {displayName(person.name, masked)}
                            </span>
                          )}
                        </td>
                        <td className="max-w-[210px] px-2 py-2">
                          {person.company_definite ? (
                            <span className="block truncate text-slate-200">
                              {person.company_definite}
                            </span>
                          ) : person.company_inferred ? (
                            <span className="inline-flex items-center gap-1.5 text-amber-300">
                              <span className="max-w-[130px] truncate">
                                {person.company_inferred}
                              </span>
                              <InferredBadge />
                            </span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="max-w-[150px] truncate px-2 py-2 text-slate-300">
                          {person.role_guess ?? <span className="text-slate-600">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2">
                          <ClosenessBar value={person.closeness} />
                        </td>
                        <td className="max-w-[150px] truncate px-2 py-2 text-slate-400">
                          {card?.location ?? <span className="text-slate-600">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2">
                          {card?.linkedin_url ? (
                            <a
                              href={card.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="LinkedIn profile"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center rounded border border-slate-700 px-1.5 py-0.5 font-mono text-[10px] leading-4 text-slate-400 hover:border-emerald-700 hover:text-emerald-300"
                            >
                              in
                            </a>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-slate-900">
                          <td colSpan={COLS} className="p-0">
                            <Expand>{renderDetail(row)}</Expand>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
