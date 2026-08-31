'use client';

// People-intent snapshot — name/company/closeness join from distilled rows IN
// CODE; the model contributes only the ranking and the one-line reason.

import Link from 'next/link';
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

  const findings = result.findings ?? [];
  const matchByName = (related: string) =>
    result.matches.find((m) => m.name === related);

  if (result.matches.length === 0 && findings.length === 0) {
    // a web-scout answer above already carries the substance — the stored
    // rows just had nothing to rank; say that instead of "no match"
    if (result.stats.web === 'ok' && result.answer) {
      return (
        <p className="text-xs text-slate-500">
          No stored row matched this directly. The answer above comes from the live web
          lookup over your closest contacts.
        </p>
      );
    }
    return (
      <div className="rounded-lg border border-slate-800 glass p-8 text-center">
        <p className="text-sm text-slate-400">No matches in your network for this one.</p>
        <p className="mt-1 text-xs text-slate-500">
          {considered === null || considered === 0
            ? 'No work-relevant contacts to search yet. Distill your chats first.'
            : `${considered} work-relevant contact${considered === 1 ? '' : 's'} considered, none fit.`}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* grounded web findings as LINKED cards — the event/news itself is
          clickable, and the involved contacts link into the Database */}
      {findings.map((f, i) => (
        <div key={i} className="rounded-lg border border-slate-800 glass p-3 sm:p-4">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            {f.url ? (
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 max-w-full break-words text-sm font-medium text-emerald-300 hover:underline"
              >
                {f.title} ↗
              </a>
            ) : (
              <span className="text-sm font-medium text-slate-100">{f.title}</span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">{f.detail}</p>
          {f.related.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-800/80 pt-2">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                your people here
              </span>
              {f.related.map((name) => {
                const m = matchByName(name);
                return m ? (
                  <Link
                    key={name}
                    href={`/database?person=${m.tg_id}`}
                    title="Open their card in the Database"
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-800 bg-emerald-950/50 px-2 py-0.5 text-[11px] text-emerald-300 hover:border-emerald-600 hover:bg-emerald-900/50"
                  >
                    <span className="max-w-[150px] truncate">{displayName(name, masked)}</span>
                    <span className="tabular-nums text-emerald-500">
                      {Math.round(m.closeness)}
                    </span>
                  </Link>
                ) : (
                  <span key={name} className="text-[11px] text-slate-400">
                    {displayName(name, masked)}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      ))}

      <p className="text-xs tabular-nums text-slate-500">
        {result.matches.length} match{result.matches.length === 1 ? '' : 'es'}
        {considered !== null && ` from ${considered} contacts considered`}
        {cityFilter &&
          (cityMatched !== null && cityMatched >= 1
            ? `; narrowed in code to ${cityMatched} located in ${cityFilter}`
            : `; nobody in your network is located in ${cityFilter}, so the full set was kept`)}
        {dropped > 0 &&
          `; ${dropped} model-suggested id${dropped === 1 ? '' : 's'} not in your database, dropped`}
      </p>
      {result.matches.map((m) => (
        <div key={m.tg_id} className="rounded-lg border border-slate-800 glass p-4">
          <div className="flex flex-wrap items-center gap-2.5">
            {m.name.trim() === '' ? (
              <span className="text-sm font-medium italic text-slate-400">(unnamed)</span>
            ) : (
              <Link
                href={`/database?person=${m.tg_id}`}
                className="text-sm font-medium text-slate-100 hover:text-emerald-300 hover:underline"
                title="Open their card in the Database"
              >
                {displayName(m.name, masked)}
              </Link>
            )}
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
