'use client';

// Inline row detail — expands directly under the table row (no drawer).
// For pending cards it is the SAME approval gate as /verify: only explicit
// user action writes the DB, and a possible_mismatch cannot be approved
// without ticking the company choice — mismatches never auto-merge.
// Edit mode posts owner corrections to /enrichments/{tg_id}/correct — a
// correction is definitive server-side (verified_by 'owner', card approved),
// so only changed non-empty fields are ever sent.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EnrichmentCard } from '@/lib/types';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';
import { InferredBadge } from '@/components/Badges';
import { ClosenessBar } from '@/components/ClosenessBar';
import { hostOf, StatusChip, type CorrectResult, type DbRow } from './shared';

// backend contract: any subset of these EXACT keys, >= 1 required
type CorrectionKey = 'name' | 'company' | 'role' | 'location' | 'linkedin_url';
type CorrectionForm = Record<CorrectionKey, string>;

const FIELDS: { key: CorrectionKey; label: string; maskable: boolean }[] = [
  { key: 'name', label: 'Name', maskable: true },
  { key: 'company', label: 'Company', maskable: false },
  { key: 'role', label: 'Role', maskable: false },
  { key: 'location', label: 'Location', maskable: false },
  { key: 'linkedin_url', label: 'LinkedIn URL', maskable: true },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <span className="min-w-0 text-slate-200">{children}</span>
    </div>
  );
}

function CardStatusChip({ status }: { status: EnrichmentCard['status'] }) {
  const base =
    'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] leading-4 whitespace-nowrap';
  if (status === 'approved') {
    return <span className={`${base} border-emerald-800 text-emerald-400`}>approved</span>;
  }
  if (status === 'rejected') {
    return <span className={`${base} border-slate-700 text-slate-500`}>rejected</span>;
  }
  return <span className={`${base} border-sky-800 text-sky-400`}>pending review</span>;
}

export function DetailPanel({
  row,
  onApprove,
  onReject,
  onCorrect,
  busy,
  error,
}: {
  row: DbRow;
  onApprove: (tgId: number, setDefinite: boolean, applyName: boolean) => void;
  onReject: (tgId: number) => void;
  onCorrect: (tgId: number, corrections: Record<string, string>) => Promise<CorrectResult>;
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

  const initial = useMemo<CorrectionForm>(
    () => ({
      name: person.name,
      company: card?.current_employer ?? person.company_definite ?? '',
      role: person.role_guess ?? '',
      location: card?.location ?? '',
      linkedin_url: card?.linkedin_url ?? '',
    }),
    [person, card],
  );
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CorrectionForm>(initial);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // server confirmed there is no card to attach the correction to
  const [notFound, setNotFound] = useState(false);

  // reset choices when the panel switches person
  useEffect(() => {
    setSetDefinite(card?.verdict === 'match');
    setApplyName(false);
    setEditing(false);
    setSaveError(null);
    setNotFound(false);
  }, [person.tg_id, card?.verdict]);

  // only changed AND non-empty fields are posted
  const corrections = useMemo(() => {
    const out: Record<string, string> = {};
    for (const { key } of FIELDS) {
      const v = form[key].trim();
      if (v !== '' && v !== initial[key].trim()) out[key] = v;
    }
    return out;
  }, [form, initial]);

  const cardMissing = !card || notFound;
  const saveDisabled = saveBusy || cardMissing || Object.keys(corrections).length === 0;

  const startEdit = () => {
    setForm(initial);
    setSaveError(null);
    setEditing(true);
  };

  const save = async () => {
    setSaveBusy(true);
    setSaveError(null);
    const res = await onCorrect(person.tg_id, corrections);
    setSaveBusy(false);
    if (res.ok) {
      setEditing(false);
    } else if (res.notFound) {
      setNotFound(true);
    } else {
      setSaveError(`correction failed: ${res.message}`);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t border-emerald-900/40 bg-slate-950/60 px-4 py-4">
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
        {card && card.verified_by !== 'owner' && <CardStatusChip status={card.status} />}
        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            className="ml-auto rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-emerald-700 hover:text-emerald-300"
          >
            Edit
          </button>
        )}
      </div>

      {isMismatch && card?.verdict_reason && (
        <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-amber-200">
          {card.verdict_reason}
        </p>
      )}
      {!isMismatch && card?.verdict_reason && (
        <p className="text-xs text-slate-500">{card.verdict_reason}</p>
      )}

      {editing ? (
        <div className="rounded-lg border border-emerald-900/60 bg-slate-900/40 p-4">
          <p className="mb-3 text-xs text-slate-400">
            Your correction is definitive: it writes the person row, marks it{' '}
            <span className="text-emerald-300">verified by owner</span>, and the card becomes
            approved. Only fields you change are sent.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map(({ key, label, maskable }) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
                <input
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  placeholder={label.toLowerCase()}
                  className={`rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-emerald-600 ${
                    maskable && masked ? 'blur-[3px] focus:blur-none' : ''
                  }`}
                />
              </label>
            ))}
          </div>
          {cardMissing && (
            <p className="mt-3 text-xs text-amber-400">
              Run Research first — corrections attach to a research card
            </p>
          )}
          {saveError && <p className="mt-3 text-xs text-red-400">{saveError}</p>}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={saveDisabled}
              onClick={() => void save()}
              className="rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {saveBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              disabled={saveBusy}
              onClick={() => setEditing(false)}
              className="rounded-md border border-slate-700 px-3.5 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:text-slate-100 disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
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

            <div className="flex flex-col gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Summary
                </p>
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
            </div>
          </div>

          {card && card.footprint.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Footprint
              </p>
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
            <div className="flex flex-wrap items-center gap-4 border-t border-slate-800/80 pt-3">
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
                  mismatches never auto-merge — approving requires the explicit company choice
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
              <span className="ml-auto flex items-center gap-2">
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
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
