'use client';

// D2 — job board. The scout dedupes companies from distilled people, hits
// PUBLIC ATS feeds (Greenhouse/Lever/Ashby/Workable/SmartRecruiters), and
// filters against the role-fit profile. Only company names leave — never
// personal data. Contacts column = the warm paths into each posting.

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_ROLE_FIT,
  type AtsSource,
  type JobPosting,
  type JobsRunSummary,
  type RoleFitProfile,
} from '@/lib/types';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';
import { DistilledBadge } from '@/components/Badges';

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? '/agents';
const ROLE_FIT_KEY = 'kw-rolefit';
const POLL_MS = 4000;

type LoadState = 'loading' | 'ready' | 'offline';

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

function loadRoleFit(): RoleFitProfile {
  try {
    const raw = window.localStorage.getItem(ROLE_FIT_KEY);
    if (!raw) return DEFAULT_ROLE_FIT;
    const parsed = JSON.parse(raw) as Partial<RoleFitProfile>;
    return {
      targetRoles: Array.isArray(parsed.targetRoles) ? parsed.targetRoles : DEFAULT_ROLE_FIT.targetRoles,
      industries: Array.isArray(parsed.industries) ? parsed.industries : DEFAULT_ROLE_FIT.industries,
      seniority: Array.isArray(parsed.seniority) ? parsed.seniority : DEFAULT_ROLE_FIT.seniority,
      location: typeof parsed.location === 'string' ? parsed.location : DEFAULT_ROLE_FIT.location,
    };
  } catch {
    return DEFAULT_ROLE_FIT;
  }
}

export default function JobsPage() {
  const { masked } = usePrivacy();
  const [state, setState] = useState<LoadState>('loading');
  const [postings, setPostings] = useState<JobPosting[]>([]);
  const [summary, setSummary] = useState<JobsRunSummary | null>(null);
  const [fitOnly, setFitOnly] = useState(true);
  const [query, setQuery] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const loadJobs = useCallback(async (fit: boolean) => {
    const res = await fetch(`${AGENTS_URL}/jobs${fit ? '?fit=1' : ''}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as JobPosting[];
    setPostings(Array.isArray(data) ? data : []);
  }, []);

  const loadSummary = useCallback(async () => {
    const res = await fetch(`${AGENTS_URL}/jobs/summary`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as JobsRunSummary | null;
    setSummary(data ?? null);
    return data ?? null;
  }, []);

  const load = useCallback(async () => {
    try {
      await Promise.all([loadJobs(fitOnly), loadSummary()]);
      setState('ready');
    } catch {
      setState('offline');
    }
  }, [loadJobs, loadSummary, fitOnly]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  useEffect(
    () => () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    },
    [],
  );

  // Poll the summary until a running scout finishes, then refresh the board.
  const watchRun = useCallback(() => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(() => {
      void (async () => {
        try {
          const s = await loadSummary();
          if (!s || s.status !== 'running') {
            if (pollRef.current !== null) window.clearInterval(pollRef.current);
            pollRef.current = null;
            setRunning(false);
            await loadJobs(fitOnly);
          }
        } catch {
          /* transient — keep polling */
        }
      })();
    }, POLL_MS);
  }, [loadSummary, loadJobs, fitOnly]);

  const runScout = async () => {
    setRunning(true);
    setError(null);
    try {
      const profile = loadRoleFit();
      const res = await fetch(`${AGENTS_URL}/jobs/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const s = (await res.json()) as JobsRunSummary;
      setSummary(s);
      if (s.status === 'running') {
        watchRun();
      } else {
        setRunning(false);
        await loadJobs(fitOnly);
      }
    } catch (e) {
      setRunning(false);
      setError(e instanceof Error ? e.message : 'job scout failed');
    }
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return postings.filter(
      (p) =>
        q === '' ||
        p.title.toLowerCase().includes(q) ||
        p.company.toLowerCase().includes(q) ||
        (p.location ?? '').toLowerCase().includes(q),
    );
  }, [postings, query]);

  if (state === 'offline') {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-lg border border-slate-800 glass p-8 text-center">
        <p className="text-sm text-slate-300">Agents service offline</p>
        <p className="mt-1 text-xs text-slate-500">
          Could not reach <code className="font-mono">{AGENTS_URL}/jobs</code>. Start the ADK
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
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Jobs</h1>
        <DistilledBadge />
        <span className="text-xs text-slate-500">
          public ATS feeds, filtered by your role-fit profile
        </span>
        <button
          type="button"
          onClick={() => void runScout()}
          disabled={running}
          className="ml-auto rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          {running ? 'Scouting…' : 'Run job scout'}
        </button>
      </div>

      <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-300">
        What leaves your browser: company names to public job feeds. (🔒 no personal data)
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {summary && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-800 glass px-4 py-2.5 text-xs tabular-nums text-slate-400">
          <span>
            <span className="text-slate-200">{summary.companies_total}</span> companies
          </span>
          <span>
            <span className="text-slate-200">{summary.companies_with_slug}</span> with ATS slug
          </span>
          <span>
            <span className="text-slate-200">{summary.postings_total}</span> postings
          </span>
          <span>
            <span className="text-emerald-300">{summary.postings_fit}</span> role-fit
          </span>
          <span className="ml-auto text-slate-600">
            {summary.status === 'running' ? 'run in progress…' : `run ${summary.run_id}`}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setFitOnly((f) => !f)}
          aria-pressed={fitOnly}
          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
            fitOnly
              ? 'border-emerald-700 bg-emerald-950/60 text-emerald-300'
              : 'border-slate-700 text-slate-400 hover:border-slate-500'
          }`}
        >
          Role-fit only {fitOnly ? '✓' : ''}
        </button>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, company, location…"
          className="ml-auto w-64 rounded-md border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
        />
        <span className="text-xs tabular-nums text-slate-500">
          {state === 'loading' ? '…' : `${rows.length.toLocaleString()} shown`}
        </span>
      </div>

      <div className="rounded-lg border border-slate-800 glass px-2 pb-2">
        {state === 'loading' ? (
          <p className="px-2 py-6 text-sm text-slate-500">Loading postings…</p>
        ) : rows.length === 0 ? (
          <div className="px-2 py-8 text-center">
            <p className="text-sm text-slate-400">
              {postings.length === 0 ? 'No postings yet.' : 'No postings match the current filters.'}
            </p>
            {postings.length === 0 && (
              <p className="mt-1 text-xs text-slate-500">
                Hit “Run job scout” above. It dedupes companies from your{' '}
                <Link href="/people" className="text-emerald-400 hover:underline">
                  people
                </Link>{' '}
                and pulls their public job feeds.
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-slate-950">
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2 font-medium">Title</th>
                  <th className="px-2 py-2 font-medium">Company</th>
                  <th className="px-2 py-2 font-medium">Source</th>
                  <th className="px-2 py-2 font-medium">Location</th>
                  <th className="px-2 py-2 font-medium">Fit</th>
                  <th className="px-2 py-2 font-medium">Warm paths</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((job) => (
                  <tr
                    key={job.id}
                    className="border-b border-slate-900 align-top hover:bg-slate-900/50"
                  >
                    <td className="max-w-[260px] px-2 py-2">
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-slate-100 hover:text-emerald-300 hover:underline"
                        title={job.title}
                      >
                        {job.title}
                      </a>
                    </td>
                    <td className="max-w-[160px] truncate px-2 py-2 text-slate-200">
                      {job.company}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">
                      <SourceBadge source={job.source} />
                    </td>
                    <td className="max-w-[150px] truncate px-2 py-2 text-slate-400">
                      {job.location ?? <span className="text-slate-600">—</span>}
                    </td>
                    <td className="max-w-[220px] px-2 py-2">
                      {job.fit_reasons.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {job.fit_reasons.map((r, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center rounded-full border border-slate-700 bg-slate-950/60 px-1.5 py-px text-[10px] leading-4 text-slate-400"
                            >
                              {r}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="max-w-[240px] px-2 py-2">
                      {job.contacts.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {job.contacts.map((c) => {
                            const nameless = c.name.trim() === '';
                            return (
                              <span
                                key={c.tg_id}
                                className="inline-flex items-center gap-1 rounded-full border border-emerald-800 bg-emerald-950/50 px-2 py-0.5 text-[11px] leading-4 text-emerald-300"
                              >
                                <span className="max-w-[120px] truncate">
                                  {nameless ? '(unnamed)' : displayName(c.name, masked)}
                                </span>
                                <span className="tabular-nums text-emerald-500">{c.closeness}</span>
                              </span>
                            );
                          })}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
