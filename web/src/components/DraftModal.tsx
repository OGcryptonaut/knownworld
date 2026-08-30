'use client';

// D3 — outreach drafter modal. SELECTION-ONLY: opens for the one
// position+contact the user picked; nothing is pre-drafted. The app never
// sends messages anywhere — the user copies the draft into Telegram.

import Link from 'next/link';
import { useState } from 'react';
import type { DraftResponse, JobContactRef, JobPosting, PipelineItem } from '@/lib/types';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? '/agents';

async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === 'string' && body.detail) return body.detail;
  } catch {
    /* non-JSON error body */
  }
  return `HTTP ${res.status}`;
}

export function DraftModal({
  contact,
  job,
  onClose,
}: {
  contact: JobContactRef;
  job: JobPosting;
  onClose: () => void;
}) {
  const { masked } = usePrivacy();
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [promoted, setPromoted] = useState<PipelineItem | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setDrafting(true);
    setDraftError(null);
    setCopied(false);
    try {
      const res = await fetch(`${AGENTS_URL}/outreach/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_id: contact.tg_id, job_id: job.id }),
      });
      if (!res.ok) throw new Error(await errorDetail(res));
      setDraft((await res.json()) as DraftResponse);
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'draft failed');
    } finally {
      setDrafting(false);
    }
  };

  const copy = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setDraftError('clipboard unavailable — select and copy manually');
    }
  };

  const promote = async () => {
    setPromoting(true);
    setPromoteError(null);
    try {
      const res = await fetch(`${AGENTS_URL}/pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tg_id: contact.tg_id,
          job_id: job.id,
          stage: 'outreach',
          draft_message: draft?.message ?? null,
        }),
      });
      if (!res.ok) throw new Error(await errorDetail(res));
      setPromoted((await res.json()) as PipelineItem);
    } catch (e) {
      setPromoteError(e instanceof Error ? e.message : 'promote failed');
    } finally {
      setPromoting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Outreach draft"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-4 shadow-xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-100">
              {displayName(contact.name, masked)}
            </h2>
            <p className="mt-0.5 truncate text-xs text-slate-400">
              {job.title} @ {job.company}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-800 hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void generate()}
            disabled={drafting}
            className="self-start rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {drafting ? 'Drafting…' : draft ? 'Regenerate' : 'Generate draft'}
          </button>

          {draftError && <p className="text-xs text-red-400">{draftError}</p>}

          {draft && (
            <>
              <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
                <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap font-mono text-xs leading-5 text-slate-200">
                  {draft.message}
                </pre>
              </div>
              <p className="text-[11px] text-slate-500">
                grounded on: {draft.grounded_on.title} @ {draft.grounded_on.company} · closeness{' '}
                <span className="tabular-nums">{draft.grounded_on.closeness}</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copy()}
                  className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-emerald-600 hover:text-emerald-300"
                >
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
                {promoted === null && (
                  <button
                    type="button"
                    onClick={() => void promote()}
                    disabled={promoting}
                    className="rounded-md border border-amber-700 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-300 hover:border-amber-500 disabled:opacity-40"
                  >
                    {promoting ? 'Promoting…' : 'Promote to pipeline'}
                  </button>
                )}
              </div>
              <p className="text-[11px] text-amber-300/90">
                You send it yourself from Telegram — the app never sends anything.
              </p>
            </>
          )}

          {promoteError && <p className="text-xs text-red-400">{promoteError}</p>}

          {promoted && (
            <p className="rounded-md border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
              Promoted to pipeline (outreach) —{' '}
              <Link href="/pipeline" className="underline hover:text-emerald-200">
                open pipeline
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
