'use client';

// v2 — Requests: plain-language queries answered ONLY from the user's own
// distilled DB + public ATS feeds. POST is synchronous (~10-30s); results
// persist as snapshots — re-asking is expected, feeds and the network move.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_ROLE_FIT, type RoleFitProfile, type UserRequest } from '@/lib/types';
import { DistilledBadge } from '@/components/Badges';
import { HistoryRail } from '@/components/requests/HistoryRail';
import { RequestResultView } from '@/components/requests/RequestResultView';

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? '/agents';
const ROLE_FIT_KEY = 'kw-rolefit';
const POLL_MS = 4000;

type LoadState = 'loading' | 'ready' | 'offline';

const EXAMPLES = [
  'I want to find a backend developer job — check postings from the last 30 days',
  "I'm going to a conference in New York — who should I meet there?",
  'Find me potential partners in stablecoin payments',
];

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

export default function RequestsPage() {
  const [state, setState] = useState<LoadState>('loading');
  const [requests, setRequests] = useState<UserRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [running, setRunning] = useState(false);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${AGENTS_URL}/requests`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as UserRequest[];
      setRequests(Array.isArray(data) ? data : []);
      setState('ready');
    } catch {
      setState('offline');
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const selected = useMemo(
    () => requests.find((r) => r.id === selectedId) ?? null,
    [requests, selectedId],
  );

  // A pre-existing 'running' doc (e.g. from another tab) — poll it to done.
  const selStatus = selected?.status;
  useEffect(() => {
    if (selectedId === null || selStatus !== 'running') return;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(`${AGENTS_URL}/requests/${selectedId}`);
          if (!res.ok) return;
          const doc = (await res.json()) as UserRequest;
          if (doc.status !== 'running') {
            setRequests((prev) => prev.map((r) => (r.id === doc.id ? doc : r)));
          }
        } catch {
          /* transient — keep polling */
        }
      })();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [selectedId, selStatus]);

  const submit = useCallback(async () => {
    const trimmed = query.trim();
    if (trimmed === '' || running) return;
    setRunning(true);
    setPendingQuery(trimmed);
    setError(null);
    setQuery('');
    try {
      const res = await fetch(`${AGENTS_URL}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed, profile: loadRoleFit() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const doc = (await res.json()) as UserRequest;
      setRequests((prev) => [doc, ...prev.filter((r) => r.id !== doc.id)]);
      setSelectedId(doc.id);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
      // restore the unsent query unless the user already typed a new one
      setQuery((q) => (q.trim() === '' ? trimmed : q));
    } finally {
      setRunning(false);
      setPendingQuery(null);
    }
  }, [query, running, load]);

  if (state === 'offline') {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center">
        <p className="text-sm text-slate-300">Agents service offline</p>
        <p className="mt-1 text-xs text-slate-500">
          Could not reach <code className="font-mono">{AGENTS_URL}/requests</code>. Start the ADK
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
        <h1 className="text-xl font-semibold tracking-tight">Requests</h1>
        <DistilledBadge />
        <span className="text-xs text-slate-500">
          ask in plain language — answered from your own network
        </span>
      </div>

      <div className="flex gap-6">
        <HistoryRail
          requests={requests}
          selectedId={selectedId}
          pendingQuery={running ? pendingQuery : null}
          loading={state === 'loading'}
          onSelect={(r) => setSelectedId(r.id)}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit();
              }}
              rows={3}
              placeholder="Ask your network anything…"
              className="w-full resize-none rounded-md border border-slate-800 bg-slate-950 px-3 py-2.5 text-base text-slate-100 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
            />
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setQuery(ex)}
                  className="max-w-full truncate rounded-full border border-slate-700 px-3 py-1 text-left text-xs text-slate-400 transition-colors hover:border-emerald-700 hover:text-emerald-300"
                >
                  {ex}
                </button>
              ))}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={running || query.trim() === ''}
                className="ml-auto inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                {running && (
                  <span
                    aria-hidden
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
                  />
                )}
                {running ? 'Planning → searching your network…' : 'Ask'}
              </button>
            </div>
            <p className="mt-2.5 text-[11px] text-slate-500">
              Requests run against your distilled database only; job feeds are public ATS boards.
              Ask again anytime — feeds and your network move.
            </p>
            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          </div>

          {selected ? (
            <RequestResultView request={selected} />
          ) : (
            !running &&
            state === 'ready' && (
              <p className="px-1 text-sm text-slate-500">
                {requests.length === 0
                  ? 'Try one of the examples above, or ask in your own words.'
                  : 'Pick a request from the history rail, or ask a new one.'}
              </p>
            )
          )}
        </div>
      </div>
    </div>
  );
}
