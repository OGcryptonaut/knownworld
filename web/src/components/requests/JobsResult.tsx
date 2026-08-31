'use client';

// Jobs-intent snapshot — public ATS postings only; warm paths join from the
// distilled DB. Window drops are shown honestly.

import Link from 'next/link';
import type { AtsSource, RequestResult } from '@/lib/types';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';

const SOURCE_STYLES: Record<AtsSource, string> = {
  greenhouse: 'border-emerald-800 bg-emerald-950/50 text-emerald-300',
  lever: 'border-sky-800 bg-sky-950/50 text-sky-300',
  ashby: 'border-violet-800 bg-violet-950/50 text-violet-300',
  workable: 'border-cyan-800 bg-cyan-950/50 text-cyan-300',
  smartrecruiters: 'border-orange-800 bg-orange-950/50 text-orange-300',
};

function SourceBadge({ source }: { source: AtsSource }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] leading-4 whitespace-nowrap ${
        SOURCE_STYLES[source] ?? 'border-slate-700 bg-slate-900/60 text-slate-400'
      }`}
    >
      {source}
    </span>
  );
}

function statNum(stats: RequestResult['stats'], key: string): number | null {
  const v = stats[key];
  return typeof v === 'number' ? v : null;
}

function Stat({ value, label, accent }: { value: number | null; label: string; accent?: boolean }) {
  return (
    <span>
      <span className={accent ? 'text-emerald-300' : 'text-slate-200'}>{value ?? '—'}</span>{' '}
      {label}
    </span>
  );
}

export function JobsResult({ result }: { result: RequestResult }) {
  const { masked } = usePrivacy();
  const windowDays = statNum(result.stats, 'window_days');
  const dropped = statNum(result.stats, 'dropped_no_posted_date') ?? 0;
  const truncated = statNum(result.stats, 'truncated') ?? 0;
  const locationFilter =
    typeof result.stats.location_filter === 'string' ? result.stats.location_filter : null;
  const locationMatched = statNum(result.stats, 'location_matched');

  // the distinct warm-path contacts across this snapshot — your people in
  // this answer, linked into the Database (a mandatory part of any answer)
  const warm = new Map<number, { tg_id: number; name: string; closeness: number }>();
  for (const p of result.postings) {
    for (const c of p.contacts) {
      if (c.name.trim() !== '' && !warm.has(c.tg_id)) warm.set(c.tg_id, c);
    }
  }
  const warmList = [...warm.values()].sort((a, b) => b.closeness - a.closeness);

  return (
    <div className="flex flex-col gap-3">
      {warmList.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            your warm paths here
          </span>
          {warmList.map((c) => (
            <Link
              key={c.tg_id}
              href={`/database?person=${c.tg_id}`}
              title="Open their card in the Database"
              className="inline-flex items-center gap-1 rounded-full border border-emerald-800 bg-emerald-950/50 px-2 py-0.5 text-[11px] text-emerald-300 hover:border-emerald-600 hover:bg-emerald-900/50"
            >
              <span className="max-w-[150px] truncate">{displayName(c.name, masked)}</span>
              <span className="tabular-nums text-emerald-500">{Math.round(c.closeness)}</span>
            </Link>
          ))}
        </div>
      )}
      {locationFilter !== null && locationMatched === 0 && result.postings.length > 0 && (
        <p className="rounded-lg border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
          None of these are in {locationFilter} — nothing matched there this run. The
          postings below are from other places.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-800 glass px-3 py-2.5 text-xs tabular-nums text-slate-400 sm:px-4">
        <Stat value={statNum(result.stats, 'companies_total')} label="companies scanned" />
        <Stat value={statNum(result.stats, 'companies_with_feed')} label="with live feeds" />
        <Stat value={statNum(result.stats, 'postings_total')} label="postings found" />
        <Stat value={statNum(result.stats, 'postings_fit')} label="fit" accent />
        <span className="ml-auto text-slate-500">
          {windowDays !== null ? `${windowDays}-day window` : 'no date window'}
        </span>
      </div>

      {dropped > 0 && (
        <p className="text-xs text-slate-500">
          {dropped} posting{dropped === 1 ? '' : 's'} had no publish date and{' '}
          {dropped === 1 ? 'was' : 'were'} excluded from the window.
        </p>
      )}
      {truncated > 0 && (
        <p className="text-xs text-slate-500">
          Snapshot capped: {truncated} more posting{truncated === 1 ? '' : 's'} not stored.
        </p>
      )}

      {result.postings.length === 0 ? (
        <div className="rounded-lg border border-slate-800 glass p-8 text-center">
          <p className="text-sm text-slate-400">No postings survived this run.</p>
          <p className="mt-1 text-xs text-slate-500">
            The stats above show exactly what was scanned and dropped. Feeds move, ask again
            next week.
          </p>
        </div>
      ) : (
        result.postings.map((job) => (
          <div key={job.id} className="rounded-lg border border-slate-800 glass p-3 sm:p-4">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 max-w-full break-words text-sm font-medium text-slate-100 hover:text-emerald-300 hover:underline"
              >
                {job.title}
              </a>
              <span className="text-sm text-slate-300">{job.company}</span>
              <SourceBadge source={job.source} />
              {job.location && <span className="text-xs text-slate-400">{job.location}</span>}
              <span className="ml-auto text-xs tabular-nums text-slate-500">
                {job.posted_at ? `posted ${job.posted_at.slice(0, 10)}` : 'no publish date'}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-800/80 pt-2.5">
              <span className="text-xs uppercase tracking-wide text-slate-500">Warm paths</span>
              {job.contacts.length === 0 ? (
                <span className="text-xs text-slate-600">none in your network</span>
              ) : (
                job.contacts.map((c) =>
                  c.name.trim() === '' ? (
                    <span
                      key={c.tg_id}
                      className="inline-flex items-center rounded-full border border-slate-800 bg-slate-950/60 px-2 py-0.5 text-[11px] leading-4 text-slate-600"
                    >
                      (unnamed)
                    </span>
                  ) : (
                    <Link
                      key={c.tg_id}
                      href={`/database?person=${c.tg_id}`}
                      title="Open their card in the Database"
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-800 bg-emerald-950/50 px-2 py-0.5 text-[11px] leading-4 text-emerald-300 hover:border-emerald-600 hover:bg-emerald-900/50"
                    >
                      <span className="max-w-[140px] truncate">{displayName(c.name, masked)}</span>
                      <span className="tabular-nums text-emerald-500">{c.closeness}</span>
                    </Link>
                  ),
                )
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
