'use client';

// Row detail drawer, shared by all three Database views. For pending cards it
// is the SAME approval gate as /verify: only explicit user approval writes the
// DB, and a possible_mismatch cannot be approved without ticking the company
// choice — mismatches never auto-merge.

import { useEffect, useState, type ReactNode } from 'react';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';
import { InferredBadge } from '@/components/Badges';
import { ClosenessBar } from '@/components/ClosenessBar';
import { hostOf, StatusChip, type DbRow } from './shared';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <span className="min-w-0 text-slate-200">{children}</span>
    </div>
  );
}

export function DetailPanel({
  row,
  onClose,
  onApprove,
  onReject,
  busy,
  error,
}: {
  row: DbRow;
  onClose: () => void;
  onApprove: (tgId: number, setDefinite: boolean, applyName: boolean) => void;
  onReject: (tgId: number) => void;
  busy: boolean;
  error: string | null;
}) {
  const { masked } = usePrivacy();
  const { person, card } = row;
  const nameBlank = person.name.trim() === '';
  const pending = card?.status === 'pending';
  const isMismatch = card?.verdict === 'possible_mismatch';
  const canApplyName = pending && nameBlank && !!card?.resolved_name;

  const [setDefinite, setSetDefinite] = useState(card?.verdict === 'match');
  const [applyName, setApplyName] = useState(false);

  // reset choices when the drawer switches person
  useEffect(() => {
    setSetDefinite(card?.verdict === 'match');
    setApplyName(false);
  }, [person.tg_id, card?.verdict]);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-950/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-slate-800 bg-slate-950 p-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-sm font-medium text-slate-100">
            {nameBlank ? (
              <span className="italic text-slate-400">(unnamed)</span>
            ) : (
              displayName(person.name, masked)
            )}
          </span>
          <span className="font-mono text-xs tabular-nums text-slate-600">tg:{person.tg_id}</span>
          <StatusChip card={card} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-400 hover:border-slate-600 hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        {isMismatch && card?.verdict_reason && (
          <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-amber-200">
            {card.verdict_reason}
          </p>
        )}
        {!isMismatch && card?.verdict_reason && (
          <p className="text-xs text-slate-500">{card.verdict_reason}</p>
        )}

        <div className="flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <Field label="Company">
            {person.company_definite ?? (
              person.company_inferred ? (
                <span className="inline-flex items-center gap-1.5 text-amber-300">
                  {person.company_inferred} <InferredBadge />
                </span>
              ) : (
                <span className="text-slate-600">—</span>
              )
            )}
          </Field>
          <Field label="Role">
            {person.role_guess ?? <span className="text-slate-600">—</span>}
          </Field>
          <Field label="Closeness">
            <ClosenessBar value={person.closeness} />
          </Field>
          <Field label="Location">
            {card?.location ?? <span className="text-slate-600">—</span>}
          </Field>
          <Field label="LinkedIn">
            {card?.linkedin_url ? (
              <a
                href={card.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-emerald-400 hover:underline"
              >
                {hostOf(card.linkedin_url)}
              </a>
            ) : (
              <span className="text-slate-600">—</span>
            )}
          </Field>
          {card?.current_employer && (
            <Field label="Evidence says">{card.current_employer}</Field>
          )}
          {canApplyName && card?.resolved_name && (
            <Field label="Name found">{displayName(card.resolved_name, masked)}</Field>
          )}
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Summary</p>
          <p className="mt-1 text-sm text-slate-300">{person.summary}</p>
        </div>

        {person.why_relevant && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Why relevant
            </p>
            <p className="mt-1 text-sm text-slate-400">{person.why_relevant}</p>
          </div>
        )}

        {card && card.footprint.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Footprint</p>
            <ul className="mt-1 list-inside list-disc text-xs text-slate-400">
              {card.footprint.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}

        {card && card.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {card.citations.map((c, i) => (
              <a
                key={i}
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                title={c.snippet ?? c.title}
                className="inline-flex max-w-[260px] items-center gap-1.5 rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-1 text-[11px] text-slate-300 hover:border-emerald-700 hover:text-emerald-300"
              >
                <span className="truncate">{c.title}</span>
                <span className="shrink-0 text-slate-600">{hostOf(c.url)}</span>
              </a>
            ))}
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        {pending && card && (
          <div className="mt-auto flex flex-col gap-3 border-t border-slate-800/80 pt-3">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={setDefinite}
                onChange={(e) => setSetDefinite(e.target.checked)}
                className="h-3.5 w-3.5 accent-emerald-600"
              />
              set company from evidence
              {card.current_employer && (
                <span className="text-slate-500">({card.current_employer})</span>
              )}
            </label>
            {isMismatch && (
              <span className="text-[11px] text-amber-400">
                mismatches never auto-merge — approving requires the explicit company choice above
              </span>
            )}
            {canApplyName && (
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={applyName}
                  onChange={(e) => setApplyName(e.target.checked)}
                  className="h-3.5 w-3.5 accent-emerald-600"
                />
                apply resolved name
              </label>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy || (isMismatch && !setDefinite)}
                onClick={() => onApprove(person.tg_id, setDefinite, canApplyName && applyName)}
                className="rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onReject(person.tg_id)}
                className="rounded-md border border-slate-700 px-3.5 py-1.5 text-xs text-slate-300 hover:border-red-800 hover:text-red-300 disabled:opacity-40"
              >
                Reject
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
