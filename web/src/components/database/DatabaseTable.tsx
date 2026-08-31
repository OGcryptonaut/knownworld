'use client';

// Database table — distilled rows joined with enrichment evidence.
// company_definite and company_inferred never merge: inferred stays amber
// with its badge. Clicking a row expands the inline detail panel directly
// under it (accordion); map/graph selections scroll the row into view.
// Filtering lives in the page's top bar (atlas-crm chain) — rows arrive
// already filtered; the table only sorts by closeness.

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';
import { InferredBadge } from '@/components/Badges';
import { ClosenessBar } from '@/components/ClosenessBar';
import type { DbRow } from './shared';

const COLS = 8; // checkbox + chevron + 6 data columns

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
  filtersActive,
  selected,
  revealNonce,
  onToggle,
  checkedIds,
  onCheck,
  onCheckAll,
  renderDetail,
}: {
  /** already filtered by the page's search + tags + selection */
  rows: DbRow[];
  filtersActive: boolean;
  selected: number | null;
  /** bumped on map/graph selections — scrolls the selected row into view */
  revealNonce: number;
  onToggle: (tgId: number) => void;
  /** batch-research selection: checked contacts + the master toggle */
  checkedIds: Set<number>;
  onCheck: (tgId: number) => void;
  onCheckAll: (ids: number[], on: boolean) => void;
  renderDetail: (row: DbRow) => ReactNode;
}) {
  const { masked } = usePrivacy();
  const [sortDesc, setSortDesc] = useState(true);
  const selectedRowRef = useRef<HTMLTableRowElement | null>(null);

  const sorted = useMemo(() => {
    const dir = sortDesc ? -1 : 1;
    return [...rows].sort((a, b) => dir * (a.person.closeness - b.person.closeness));
  }, [rows, sortDesc]);

  useEffect(() => {
    if (revealNonce === 0) return;
    // bring the clicked person's row (card right under it) to the top:
    // first pass after the accordion animation, a safety pass after smooth
    // scrolling and layout fully settle — skipped when already in view
    const scrollToRow = () => {
      const el = selectedRowRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top < 56 || r.top > window.innerHeight * 0.55) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    const t1 = window.setTimeout(scrollToRow, 260);
    const t2 = window.setTimeout(scrollToRow, 900);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [revealNonce]);

  return (
    <div className="rounded-lg border border-slate-800 glass px-2 pb-2">
      {sorted.length === 0 ? (
        <p className="px-2 py-6 text-sm text-slate-500">
          {filtersActive
            ? 'No people match the current filters.'
            : 'No people yet. Distill your chats first.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="w-7 px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={sorted.length > 0 && sorted.every((r) => checkedIds.has(r.person.tg_id))}
                    onChange={(e) =>
                      onCheckAll(
                        sorted.map((r) => r.person.tg_id),
                        e.target.checked,
                      )
                    }
                    className="h-3.5 w-3.5 cursor-pointer accent-amber-500"
                  />
                </th>
                <th className="w-6 px-2 py-2" aria-label="Expand" />
                <th className="px-2 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium">Company</th>
                <th className="px-2 py-2 font-medium">Role</th>
                <th className="px-2 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => setSortDesc((d) => !d)}
                    className="uppercase tracking-wide hover:text-slate-200"
                  >
                    Closeness {sortDesc ? '▼' : '▲'}
                  </button>
                </th>
                <th className="px-2 py-2 font-medium">Location</th>
                <th className="px-2 py-2 font-medium">Links</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const { person, card } = row;
                const expanded = person.tg_id === selected;
                return (
                  <Fragment key={`${person.tg_id}-${person.run_id}`}>
                    <tr
                      ref={expanded ? selectedRowRef : undefined}
                      onClick={() => onToggle(person.tg_id)}
                      aria-expanded={expanded}
                      className={`cursor-pointer border-b align-top scroll-mt-14 ${
                        expanded
                          ? 'border-transparent bg-slate-900/60'
                          : 'border-slate-900 hover:bg-slate-900/50'
                      }`}
                    >
                      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${person.name || person.tg_id} for research`}
                          checked={checkedIds.has(person.tg_id)}
                          onChange={() => onCheck(person.tg_id)}
                          className="h-3.5 w-3.5 cursor-pointer accent-amber-500"
                        />
                      </td>
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
  );
}
