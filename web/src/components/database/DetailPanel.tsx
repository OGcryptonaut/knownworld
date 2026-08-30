'use client';

// Inline row detail — expands directly under the table row (no drawer).
// v2: findings AUTO-APPLY server-side; there is no approve/reject ceremony.
// The one user action is EDIT: owner corrections post to
// /enrichments/{tg_id}/correct and are definitive (verified_by 'owner').
// A possible_mismatch still never rewrites the company silently — the badge
// surfaces it and Edit resolves it.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ChatMeta } from '@/lib/types';
import { getChatMeta } from '@/lib/db';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';
import { InferredBadge } from '@/components/Badges';
import { ClosenessBar } from '@/components/ClosenessBar';
import { relTime } from '../requests/shared';
import { companyOf, hostOf, tagsOf, type CorrectResult, type DbRow } from './shared';

/** Rough source category from the URL, computed in code (atlas-crm style). */
function sourceType(url: string): string {
  const h = hostOf(url).toLowerCase();
  if (h.includes('linkedin.')) return 'linkedin';
  if (h === 'x.com' || h.includes('twitter.')) return 'x';
  if (h.includes('wikipedia.')) return 'wiki';
  if (h.includes('github.')) return 'github';
  if (h.includes('medium.') || h.includes('substack.')) return 'blog';
  if (h.includes('crunchbase.') || h.includes('rocketreach.')) return 'directory';
  return 'web';
}

// backend contract: any subset of these EXACT keys, >= 1 required.
// Every text block the card renders is editable (atlas-crm contract: the
// whole card is the owner's document, not just the identity line).
type CorrectionKey =
  | 'name'
  | 'company'
  | 'role'
  | 'location'
  | 'linkedin_url'
  | 'why_relevant'
  | 'note'
  | 'summary'
  | 'current_focus'
  | 'how_useful'
  | 'history'
  | 'footprint';
type CorrectionForm = Record<CorrectionKey, string>;

// short identity fields — the input grid
const FIELDS: { key: CorrectionKey; label: string; maskable: boolean }[] = [
  { key: 'name', label: 'Name', maskable: true },
  { key: 'company', label: 'Company', maskable: false },
  { key: 'role', label: 'Role', maskable: false },
  { key: 'location', label: 'Location', maskable: false },
  { key: 'linkedin_url', label: 'LinkedIn URL', maskable: true },
  { key: 'why_relevant', label: 'Why work-relevant', maskable: false },
];

// narrative blocks — full-width textareas; list-shaped ones are one line
// per entry and the server splits them
const TEXT_FIELDS: {
  key: CorrectionKey;
  label: string;
  rows: number;
  placeholder: string;
}[] = [
  {
    key: 'note',
    label: 'Owner’s assessment. Yours alone, research never touches it',
    rows: 2,
    placeholder: 'e.g. Slow to reply, worth the wait.',
  },
  {
    key: 'summary',
    label: 'From your chats',
    rows: 2,
    placeholder: 'what your own conversations say about them',
  },
  {
    key: 'current_focus',
    label: 'What they do now',
    rows: 2,
    placeholder: 'their current work, in a sentence or two',
  },
  {
    key: 'how_useful',
    label: 'How they can help you',
    rows: 2,
    placeholder: 'the door this person opens for you',
  },
  {
    key: 'history',
    label: 'Work history, one line per role, newest first',
    rows: 3,
    placeholder: '2024- Acme - Head of BD\n2020-2024 - OldCorp - Partnerships',
  },
  {
    key: 'footprint',
    label: 'Footprint, one line per fact',
    rows: 2,
    placeholder: 'Speaks at payments conferences\nWrites a newsletter',
  },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <span className="min-w-0 text-slate-200">{children}</span>
    </div>
  );
}

/** Section header, atlas-crm style: one brand color, a filled tag with a
 *  solid left rail — a structural marker, not a decoration. */
function Section({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <div>
      <span className="inline-flex max-w-full items-baseline gap-1.5 border-l-[3px] border-emerald-500 bg-emerald-500/10 py-0.5 pl-2 pr-2.5">
        <span className="min-w-0 truncate text-xs font-medium text-emerald-300">{label}</span>
        {count != null && (
          <span className="shrink-0 text-[11px] tabular-nums text-emerald-400/70">{count}</span>
        )}
      </span>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export function DetailPanel({
  row,
  onCorrect,
  error,
}: {
  row: DbRow;
  onCorrect: (tgId: number, corrections: Record<string, string>) => Promise<CorrectResult>;
  error: string | null;
}) {
  const { masked } = usePrivacy();
  const { person, card } = row;
  const nameBlank = person.name.trim() === '';
  const isMismatch = card?.verdict === 'possible_mismatch';
  const tags = tagsOf(row);
  const subtitle = [companyOf(row).name, person.role_guess].filter(Boolean).join(' · ');

  const initial = useMemo<CorrectionForm>(
    () => ({
      name: person.name,
      company: card?.current_employer ?? person.company_definite ?? '',
      role: person.role_guess ?? '',
      location: card?.location ?? '',
      linkedin_url: card?.linkedin_url ?? '',
      why_relevant: person.why_relevant ?? '',
      note: person.owner_note ?? '',
      summary: person.summary,
      current_focus: card?.current_focus ?? '',
      how_useful: card?.how_useful ?? '',
      history: (card?.history ?? []).join('\n'),
      footprint: (card?.footprint ?? []).join('\n'),
    }),
    [person, card],
  );
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CorrectionForm>(initial);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // server confirmed there is no card to attach the correction to
  const [notFound, setNotFound] = useState(false);

  // your chat history with this person, straight from the local IndexedDB —
  // null when this browser has no import (e.g. a different device)
  const [chatMeta, setChatMeta] = useState<ChatMeta | null>(null);

  // reset edit state when the panel switches person
  useEffect(() => {
    setEditing(false);
    setSaveError(null);
    setNotFound(false);
    setChatMeta(null);
    getChatMeta(person.tg_id)
      .then((m) => setChatMeta(m ?? null))
      .catch(() => setChatMeta(null));
  }, [person.tg_id]);

  // only changed AND non-empty fields are posted
  const corrections = useMemo(() => {
    const out: Record<string, string> = {};
    for (const { key } of [...FIELDS, ...TEXT_FIELDS]) {
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
    <div className="flex flex-col gap-3 border-t border-emerald-900/40 bg-slate-950/60 px-3 py-4 sm:px-4">
      {/* atlas-style header zone: name, company · role, place, tags */}
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-base font-semibold text-slate-100">
            {nameBlank ? (
              <span className="italic font-normal text-slate-400">(unnamed)</span>
            ) : (
              displayName(person.name, masked)
            )}
          </span>
          <span className="font-mono text-xs tabular-nums text-slate-600">tg:{person.tg_id}</span>
          {person.verified === 'owner' && (
            <span className="inline-flex items-center rounded-full border border-emerald-700 bg-emerald-950/60 px-2 py-0.5 text-[11px] leading-4 text-emerald-300">
              ✓ verified by you
            </span>
          )}
          {!editing && (
            <button
              type="button"
              onClick={startEdit}
              className="ml-auto rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-emerald-700 hover:text-emerald-300"
            >
              ✎ Edit
            </button>
          )}
        </div>
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
        {card?.location && <p className="text-xs text-slate-500">📍 {card.location}</p>}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <span
                key={t}
                className="rounded border border-emerald-800/60 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] text-emerald-300/90"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {isMismatch && card?.verdict_reason && (
        <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-amber-200">
          {card.verdict_reason}. The stored company was not overwritten. Hit Edit to resolve it.
        </p>
      )}

      {editing ? (
        <div className="rounded-lg border border-emerald-900/60 bg-slate-900/40 p-4">
          <p className="mb-3 text-xs text-slate-400">
            Your correction is definitive: it writes the person row and marks it{' '}
            <span className="text-emerald-300">verified by owner</span>. Only fields you change
            are sent.
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
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {TEXT_FIELDS.map(({ key, label, rows, placeholder }) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
                <textarea
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  rows={rows}
                  placeholder={placeholder}
                  className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-emerald-600"
                />
              </label>
            ))}
          </div>
          {person.verified === 'owner' && (
            <p className="mt-2 text-[11px] text-emerald-400/80">
              This row is verified by you. New research refreshes facts around your edits,
              never over them.
            </p>
          )}
          {cardMissing && (
            <p className="mt-3 text-xs text-amber-400">
              Run Research first. Corrections attach to a research card.
            </p>
          )}
          {saveError && <p className="mt-3 text-xs text-red-400">{saveError}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
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
          {/* three balanced columns: identity | narrative | evidence lists —
              no dead space next to short narrative text */}
          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                    className={`break-all text-emerald-400 hover:underline ${
                      masked ? 'blur-[3px] hover:blur-none' : ''
                    }`}
                  >
                    {card.linkedin_url.replace(/^https?:\/\/(www\.)?/, '')}
                  </a>
                ) : (
                  <span className="text-slate-600">—</span>
                )}
              </Field>
              {card?.current_employer && (
                <Field label="Evidence says">{card.current_employer}</Field>
              )}
            </div>

            <div className="flex flex-col gap-3">
              {card?.current_focus && (
                <Section label="What they do now">
                  <p className="text-sm text-slate-300">{card.current_focus}</p>
                </Section>
              )}
              {card?.how_useful && (
                <Section label="How they can help you">
                  <p className="text-sm text-emerald-200/90">{card.how_useful}</p>
                </Section>
              )}
              {person.owner_note && (
                <Section label="Owner’s assessment">
                  <p className="rounded-md border border-emerald-900/50 bg-emerald-950/20 px-3 py-2 text-sm italic text-emerald-100/90">
                    {person.owner_note}
                  </p>
                </Section>
              )}
              <Section label="From your chats">
                <p className="text-sm text-slate-300">{person.summary}</p>
                {person.why_relevant && (
                  <p className="mt-1 text-xs text-slate-500">{person.why_relevant}</p>
                )}
              </Section>
            </div>

            <div className="flex flex-col gap-3 md:col-span-2 xl:col-span-1">
              {card && (card.history?.length ?? 0) > 0 && (
                <Section label="Work history" count={card.history!.length}>
                  <ul className="flex flex-col gap-1 text-xs text-slate-400">
                    {card.history!.map((h, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-slate-600">•</span>
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {card && card.footprint.length > 0 && (
                <Section label="Footprint" count={card.footprint.length}>
                  <ul className="list-inside list-disc text-xs text-slate-400">
                    {card.footprint.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </Section>
              )}

              {card && card.citations.length > 0 && (
                <Section label="All sources" count={card.citations.length}>
              <ul className="mt-1 flex flex-col gap-0.5">
                {card.citations.map((c, i) => (
                  <li key={i} className="truncate text-xs">
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={c.snippet ?? c.title}
                      className="text-emerald-400/90 hover:underline"
                    >
                      <span className="text-slate-500">[{sourceType(c.url)}]</span> {c.title}
                    </a>
                    <span className="ml-1.5 text-slate-600">{hostOf(c.url)}</span>
                  </li>
                ))}
              </ul>
            </Section>
              )}
            </div>
          </div>

          {/* your own history with this person — local IndexedDB data, never
              from a model; falls back to the distilled row on other devices */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-800/60 pt-2.5 text-[11px] text-slate-500">
            <span className="font-medium uppercase tracking-wide text-slate-600">Telegram</span>
            <span className="tabular-nums">
              {(chatMeta?.msgCount ?? person.msg_volume).toLocaleString()} messages
            </span>
            {chatMeta && (
              <span className="tabular-nums">
                you {chatMeta.myCount.toLocaleString()} / them{' '}
                {chatMeta.theirCount.toLocaleString()}
              </span>
            )}
            {chatMeta?.firstDate && (
              <span>since {new Date(chatMeta.firstDate).getFullYear()}</span>
            )}
            {(person.last_contact ?? chatMeta?.lastDate) && (
              <span>last message {relTime((person.last_contact ?? chatMeta?.lastDate)!)}</span>
            )}
            {card && (
              <span className="ml-auto text-slate-600">
                researched {relTime(card.created_at)}
              </span>
            )}
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </>
      )}
    </div>
  );
}
