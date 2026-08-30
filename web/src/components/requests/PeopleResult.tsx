'use client';

// People-intent snapshot — name/company/closeness join from distilled rows IN
// CODE; the model contributes only the ranking and the one-line reason.

import type { RequestResult } from '@/lib/types';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';
import { ClosenessBar } from '@/components/ClosenessBar';

export function PeopleResult({ result }: { result: RequestResult }) {
  const { masked } = usePrivacy();
  const considered =
    typeof result.stats.considered === 'number' ? result.stats.considered : null;
  const dropped =
    typeof result.stats.dropped_unknown === 'number' ? result.stats.dropped_unknown : 0;
  const cityFilter =
    typeof result.stats.city_filter === 'string' ? result.stats.city_filter : null;
  const cityMatched =
    typeof result.stats.city_matched === 'number' ? result.stats.city_matched : null;

  if (result.matches.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center">
        <p className="text-sm text-slate-400">No matches in your network for this one.</p>
        <p className="mt-1 text-xs text-slate-500">
          {considered === null || considered === 0
            ? 'No work-relevant contacts to search yet — run Refine first.'
            : `${considered} work-relevant contact${considered === 1 ? '' : 's'} considered — none fit.`}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs tabular-nums text-slate-500">
        {result.matches.length} match{result.matches.length === 1 ? '' : 'es'}
        {considered !== null && ` from ${considered} contacts considered`}
        {cityFilter &&
          (cityMatched !== null && cityMatched >= 3
            ? `; narrowed in code to ${cityMatched} located in ${cityFilter}`
            : `; ${cityFilter} filter matched ${cityMatched ?? 0} — kept the full set`)}
        {dropped > 0 &&
          `; ${dropped} model-suggested id${dropped === 1 ? '' : 's'} not in your DB — dropped`}
      </p>
      {result.matches.map((m) => (
        <div key={m.tg_id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-sm font-medium text-slate-100">
              {m.name.trim() === '' ? (
                <span className="italic text-slate-400">(unnamed)</span>
              ) : (
                displayName(m.name, masked)
              )}
            </span>
            {m.company && <span className="text-sm text-slate-300">{m.company}</span>}
            {m.role_guess && <span className="text-xs text-slate-400">{m.role_guess}</span>}
            <span className="ml-auto">
              <ClosenessBar value={m.closeness} />
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            <span className="uppercase tracking-wide text-slate-500">why:</span> {m.reason}
          </p>
        </div>
      ))}
    </div>
  );
}
