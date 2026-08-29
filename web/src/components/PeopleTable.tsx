'use client';

// Distilled-people table, shared by /refine (live panel) and /people.
// company_definite and company_inferred are SEPARATE columns and never merge;
// inferred values are styled amber with an explicit badge.

import type { DistilledPerson } from '@/lib/types';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';
import { InferredBadge } from '@/components/Badges';
import { ClosenessBar } from '@/components/ClosenessBar';

export function PeopleTable({
  people,
  emptyText = 'No people yet.',
  maxHeightClass = '',
}: {
  people: DistilledPerson[];
  emptyText?: string;
  maxHeightClass?: string;
}) {
  const { masked } = usePrivacy();

  if (people.length === 0) {
    return <p className="px-1 py-6 text-sm text-slate-500">{emptyText}</p>;
  }

  return (
    <div className={`overflow-x-auto ${maxHeightClass ? `overflow-y-auto ${maxHeightClass}` : ''}`}>
      <table className="w-full min-w-[880px] border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-slate-950">
          <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-2 py-2 font-medium">Name</th>
            <th className="px-2 py-2 font-medium">Company (definite)</th>
            <th className="px-2 py-2 font-medium">Company (inferred)</th>
            <th className="px-2 py-2 font-medium">Role guess</th>
            <th className="px-2 py-2 font-medium">Closeness</th>
            <th className="px-2 py-2 font-medium">Summary</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr
              key={`${p.tg_id}-${p.run_id}`}
              className="border-b border-slate-900 align-top hover:bg-slate-900/50"
            >
              <td className="max-w-[180px] truncate px-2 py-2 text-slate-100">
                {displayName(p.name, masked)}
                {!p.work_relevant && (
                  <span className="ml-1.5 text-[10px] text-slate-600" title={p.why_relevant}>
                    non-work
                  </span>
                )}
              </td>
              <td className="max-w-[160px] truncate px-2 py-2 text-slate-200">
                {p.company_definite ?? <span className="text-slate-600">—</span>}
              </td>
              <td className="max-w-[200px] px-2 py-2">
                {p.company_inferred ? (
                  <span className="inline-flex items-center gap-1.5 text-amber-300">
                    <span className="max-w-[130px] truncate">{p.company_inferred}</span>
                    <InferredBadge />
                  </span>
                ) : (
                  <span className="text-slate-600">—</span>
                )}
              </td>
              <td className="max-w-[150px] truncate px-2 py-2 text-slate-300">
                {p.role_guess ?? <span className="text-slate-600">—</span>}
              </td>
              <td className="whitespace-nowrap px-2 py-2">
                <ClosenessBar value={p.closeness} />
              </td>
              <td className="px-2 py-2 text-slate-400">
                <span className="line-clamp-2 max-w-[340px]" title={p.summary}>
                  {p.summary}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
