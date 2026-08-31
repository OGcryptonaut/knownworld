'use client';

// D3 — pipeline kanban. Tracks warm-outreach leads through the stages.
// Everything here is user-driven: promote from /jobs, then move cards by hand.

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PIPELINE_STAGES, type PipelineItem, type PipelineStage } from '@/lib/types';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? '/agents';

type LoadState = 'loading' | 'ready' | 'offline';

const STAGE_LABELS: Record<PipelineStage, string> = {
  lead: 'Lead',
  outreach: 'Outreach',
  referred: 'Referred',
  interview: 'Interview',
  offer: 'Offer',
  closed: 'Closed',
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function isOverdue(item: PipelineItem): boolean {
  if (!item.follow_up_date) return false;
  if (item.stage === 'offer' || item.stage === 'closed') return false;
  return item.follow_up_date.slice(0, 10) < todayISO();
}

export default function PipelinePage() {
  const { masked } = usePrivacy();
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${AGENTS_URL}/pipeline`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PipelineItem[];
      setItems(Array.isArray(data) ? data : []);
      setState('ready');
    } catch {
      setState('offline');
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const patchItem = useCallback(
    async (
      id: string,
      patch: Partial<Pick<PipelineItem, 'stage' | 'follow_up_date' | 'note' | 'draft_message'>>,
    ) => {
      setError(null);
      try {
        const res = await fetch(`${AGENTS_URL}/pipeline/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const updated = (await res.json()) as PipelineItem;
        setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
      } catch (e) {
        setError(e instanceof Error ? `update failed: ${e.message}` : 'update failed');
      }
    },
    [],
  );

  const byStage = useMemo(() => {
    const map = new Map<PipelineStage, PipelineItem[]>(PIPELINE_STAGES.map((s) => [s, []]));
    for (const item of items) map.get(item.stage)?.push(item);
    return map;
  }, [items]);

  if (state === 'offline') {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center">
        <p className="text-sm text-slate-300">Agents service offline</p>
        <p className="mt-1 text-xs text-slate-500">
          Could not reach <code className="font-mono">{AGENTS_URL}/pipeline</code>. Start the ADK
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
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Pipeline</h1>
        <span className="text-xs text-slate-500">
          lead → outreach → referred → interview → offer / closed
        </span>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {state === 'loading' ? (
        <p className="py-6 text-sm text-slate-500">Loading pipeline…</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-10 text-center">
          <p className="text-sm text-slate-400">Nothing in the pipeline yet.</p>
          <p className="mt-1 text-xs text-slate-500">
            Warm-path conversations you decide to pursue land here, stage by stage: lead,
            outreach, referred, interview, offer.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[1140px] grid-cols-6 gap-3">
            {PIPELINE_STAGES.map((stage) => {
              const cards = byStage.get(stage) ?? [];
              return (
                <div key={stage} className="rounded-lg border border-slate-800 bg-slate-900/40">
                  <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-300">
                      {STAGE_LABELS[stage]}
                    </span>
                    <span className="text-xs tabular-nums text-slate-500">{cards.length}</span>
                  </div>
                  <div className="flex flex-col gap-2 p-2">
                    {cards.length === 0 && (
                      <p className="px-1 py-3 text-center text-[11px] text-slate-600">—</p>
                    )}
                    {cards.map((item) => {
                      const idx = PIPELINE_STAGES.indexOf(item.stage);
                      const overdue = isOverdue(item);
                      return (
                        <div
                          key={item.id}
                          className="rounded-md border border-slate-800 bg-slate-950/60 p-2.5"
                        >
                          <div className="flex items-start justify-between gap-1">
                            <div className="min-w-0">
                              <p className="truncate text-sm text-slate-100">
                                {displayName(item.contact_name, masked)}
                              </p>
                              <p className="truncate text-[11px] text-slate-400">{item.company}</p>
                            </div>
                            <div className="flex shrink-0 gap-0.5">
                              <button
                                type="button"
                                disabled={idx <= 0}
                                onClick={() =>
                                  void patchItem(item.id, { stage: PIPELINE_STAGES[idx - 1] })
                                }
                                aria-label="Move to previous stage"
                                title="Move left"
                                className="rounded px-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-30 disabled:hover:bg-transparent"
                              >
                                ←
                              </button>
                              <button
                                type="button"
                                disabled={idx >= PIPELINE_STAGES.length - 1}
                                onClick={() =>
                                  void patchItem(item.id, { stage: PIPELINE_STAGES[idx + 1] })
                                }
                                aria-label="Move to next stage"
                                title="Move right"
                                className="rounded px-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-30 disabled:hover:bg-transparent"
                              >
                                →
                              </button>
                            </div>
                          </div>

                          {item.job_title && (
                            <p className="mt-1 truncate text-[11px]">
                              {item.job_url ? (
                                <a
                                  href={item.job_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-emerald-400 hover:underline"
                                  title={item.job_title}
                                >
                                  {item.job_title}
                                </a>
                              ) : (
                                <span className="text-slate-300">{item.job_title}</span>
                              )}
                            </p>
                          )}

                          <div className="mt-2 flex items-center gap-1.5">
                            {overdue && (
                              <span className="inline-flex items-center rounded-full border border-red-800 bg-red-950/50 px-1.5 py-px text-[10px] leading-4 text-red-400">
                                OVERDUE
                              </span>
                            )}
                            <input
                              type="date"
                              value={item.follow_up_date?.slice(0, 10) ?? ''}
                              onChange={(e) =>
                                void patchItem(item.id, {
                                  follow_up_date: e.target.value || null,
                                })
                              }
                              aria-label="Follow-up date"
                              className={`w-full rounded border bg-slate-950 px-1.5 py-0.5 text-[11px] text-slate-300 focus:border-emerald-600 focus:outline-none [color-scheme:dark] ${
                                overdue ? 'border-red-900' : 'border-slate-800'
                              }`}
                            />
                          </div>

                          <textarea
                            key={`${item.id}-${item.updated_at}`}
                            defaultValue={item.note}
                            placeholder="note…"
                            rows={2}
                            onBlur={(e) => {
                              if (e.target.value !== item.note) {
                                void patchItem(item.id, { note: e.target.value });
                              }
                            }}
                            aria-label="Note"
                            className="mt-2 w-full resize-none rounded border border-slate-800 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-300 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
