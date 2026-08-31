'use client';

// Left rail — request THREADS, newest activity first. A thread is the first
// question plus its follow-ups; selecting one opens the whole conversation,
// and Ask continues it. "New request" starts a fresh thread.

import type { UserRequest } from '@/lib/types';
import { relTime, StatusChip } from './shared';

export interface RequestThread {
  id: string; // the root request's id
  root: UserRequest;
  latest: UserRequest;
  count: number;
}

export function HistoryRail({
  threads,
  selectedThreadId,
  loading,
  onSelect,
  onNew,
}: {
  threads: RequestThread[];
  selectedThreadId: string | null;
  loading: boolean;
  onSelect: (threadId: string) => void;
  onNew: () => void;
}) {
  return (
    <aside className="w-full min-w-0 md:w-64 md:shrink-0">
      <div className="flex items-center gap-2 px-1">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">History</p>
        <button
          type="button"
          onClick={onNew}
          aria-pressed={selectedThreadId === null}
          className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
            selectedThreadId === null
              ? 'border-emerald-700 bg-emerald-950/60 text-emerald-300'
              : 'border-slate-700 text-slate-400 hover:border-emerald-700 hover:text-emerald-300'
          }`}
        >
          + New request
        </button>
      </div>
      {/* <md: horizontal scrollable chip row above the composer; md+: vertical rail */}
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1.5 md:flex-col md:overflow-x-visible md:pb-0">
        {loading ? (
          <p className="shrink-0 px-1 py-4 text-xs text-slate-500">Loading history…</p>
        ) : threads.length === 0 ? (
          <p className="shrink-0 px-1 py-4 text-xs text-slate-500">
            No requests yet. Ask your first one.
          </p>
        ) : (
          threads.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              aria-pressed={t.id === selectedThreadId}
              className={`w-60 shrink-0 rounded-lg border px-3 py-2 text-left transition-colors md:w-full ${
                t.id === selectedThreadId
                  ? 'border-emerald-700 bg-emerald-950/30'
                  : 'border-slate-800 bg-slate-900/40 hover:border-slate-600'
              }`}
            >
              <p className="truncate text-xs text-slate-200" title={t.root.query}>
                {t.root.query}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <StatusChip status={t.latest.status} />
                {t.count > 1 && (
                  <span className="rounded-full border border-slate-700 px-1.5 text-[10px] leading-4 text-slate-400">
                    {t.count} asks
                  </span>
                )}
                <span
                  className="ml-auto text-[11px] tabular-nums text-slate-500"
                  title={t.latest.created_at}
                >
                  {relTime(t.latest.created_at)}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
