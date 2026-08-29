'use client';

// Left rail — past requests, newest first. Each entry is a stored snapshot;
// re-asking later is the point (feeds and the network move).

import type { UserRequest } from '@/lib/types';
import { relTime, StatusChip } from './shared';

export function HistoryRail({
  requests,
  selectedId,
  pendingQuery,
  loading,
  onSelect,
}: {
  requests: UserRequest[];
  selectedId: string | null;
  /** query of an in-flight submit — rendered as a pulsing row at the top */
  pendingQuery: string | null;
  loading: boolean;
  onSelect: (request: UserRequest) => void;
}) {
  return (
    <aside className="w-64 shrink-0">
      <p className="px-1 text-xs font-medium uppercase tracking-wide text-slate-500">History</p>
      <div className="mt-2 flex flex-col gap-1.5">
        {pendingQuery !== null && (
          <div className="rounded-lg border border-sky-900/70 bg-slate-900/40 px-3 py-2">
            <p className="truncate text-xs text-slate-300" title={pendingQuery}>
              {pendingQuery}
            </p>
            <div className="mt-1">
              <StatusChip status="running" />
            </div>
          </div>
        )}
        {loading ? (
          <p className="px-1 py-4 text-xs text-slate-500">Loading history…</p>
        ) : requests.length === 0 && pendingQuery === null ? (
          <p className="px-1 py-4 text-xs text-slate-500">No requests yet — ask your first one.</p>
        ) : (
          requests.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect(r)}
              aria-pressed={r.id === selectedId}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                r.id === selectedId
                  ? 'border-emerald-700 bg-emerald-950/30'
                  : 'border-slate-800 bg-slate-900/40 hover:border-slate-600'
              }`}
            >
              <p className="truncate text-xs text-slate-200" title={r.query}>
                {r.query}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <StatusChip status={r.status} />
                <span className="text-[11px] tabular-nums text-slate-500" title={r.created_at}>
                  {relTime(r.created_at)}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
