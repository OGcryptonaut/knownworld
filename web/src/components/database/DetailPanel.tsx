'use client';

// Inline row detail — expands directly under the table row (no drawer).
// v2: findings AUTO-APPLY server-side; there is no approve/reject ceremony.
// The one user action is EDIT: owner corrections post to
// /enrichments/{tg_id}/correct and are definitive (verified_by 'owner').
// A possible_mismatch still never rewrites the company silently — the badge
// surfaces it and Edit resolves it.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ActivityEntry, CardUpdate, ChatMeta } from '@/lib/types';
import { getChatMeta } from '@/lib/db';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';
import { InferredBadge } from '@/components/Badges';
import { ClosenessBar } from '@/components/ClosenessBar';
import { appendLog, logLine, RunLog, type LogLine } from '@/components/onboarding/RunLog';
import { relTime } from '../requests/shared';
import { companyOf, hostOf, tagsOf, type CorrectResult, type DbRow } from './shared';

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? '/agents';
const RESEARCH_POLL_MS = 1500;
const RESEARCH_HEARTBEAT_MS = 8000;

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

// re-research changelog, atlas-crm style: collapsed dated rows; opening one
// shows the exact old -> new diffs and the pass's own sources
const FIELD_LABELS: Record<string, string> = {
  current_employer: 'company',
  current_focus: 'what they do now',
  how_useful: 'how they can help',
  location: 'location',
  linkedin_url: 'linkedin',
  verdict: 'verdict',
  history: 'work history',
  footprint: 'footprint',
};

function UpdateRow({ u }: { u: CardUpdate }) {
  const [open, setOpen] = useState(false);
  const labels = u.changed.map((c) => FIELD_LABELS[c.field] ?? c.field).join(', ');
  return (
    <div className="border-l-2 border-emerald-700/40 pl-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline gap-1.5 py-0.5 text-left hover:text-slate-200"
      >
        <span className="shrink-0 text-[10px] text-slate-500">{open ? '▾' : '▸'}</span>
        <span className="shrink-0 font-mono text-[10px] text-slate-300">{u.at.slice(0, 10)}</span>
        <span className="min-w-0 truncate text-[10px] text-slate-500">
          · {labels || 're-checked, nothing new'}
        </span>
      </button>
      {open && (
        <div className="pb-1.5 pt-0.5">
          {u.changed.length === 0 ? (
            <p className="text-[11px] text-slate-500">
              Re-checked. Everything matched the previous pass.
            </p>
          ) : (
            <ul className="space-y-1">
              {u.changed.map((c) => {
                const long = (c.old ?? '').length > 55 || (c.new ?? '').length > 55;
                const label = FIELD_LABELS[c.field] ?? c.field;
                return long ? (
                  <li key={c.field} className="break-words font-mono text-xs">
                    <span className="text-slate-500">{label}:</span>
                    <span className="mt-0.5 block whitespace-pre-wrap text-slate-600 line-through">
                      {c.old ?? '—'}
                    </span>
                    <span className="mt-0.5 block whitespace-pre-wrap text-slate-200">
                      {c.new ?? '—'}
                    </span>
                  </li>
                ) : (
                  <li key={c.field} className="break-words font-mono text-xs">
                    <span className="text-slate-500">{label}: </span>
                    <span className="text-slate-600 line-through">{c.old ?? '—'}</span>
                    <span className="text-slate-500"> → </span>
                    <span className="text-slate-200">{c.new ?? '—'}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {u.citations.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="text-[10px] text-slate-600">sources</span>
              {u.citations.map((c, i) => (
                <a
                  key={i}
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={c.title}
                  className="text-[10px] text-emerald-400/80 underline decoration-dotted hover:text-emerald-300"
                >
                  {hostOf(c.url)}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
  onResearchAgain,
}: {
  row: DbRow;
  onCorrect: (tgId: number, corrections: Record<string, string>) => Promise<CorrectResult>;
  /** one more grounded pass; resolves to an error message or null. runId is
   *  client-minted so this card can watch the pass's activity trail live */
  onResearchAgain: (tgId: number, runId: string) => Promise<string | null>;
}) {
  const { masked } = usePrivacy();
  const { person, card } = row;
  const nameBlank = person.name.trim() === '';
  // an owner correction RESOLVES the flag — the banner must not outlive it
  const isMismatch = card?.verdict === 'possible_mismatch' && card?.verified_by !== 'owner';
  const tags = tagsOf(row);
  const subtitle = [companyOf(row).name, person.role_guess].filter(Boolean).join(' · ');

  const initial = useMemo<CorrectionForm>(
    () => ({
      name: person.name,
      // DB value first: on a possible-mismatch the owner accepts the
      // evidence company by TYPING it — prefilling the evidence value would
      // make that exact edit read as "unchanged" and never send
      company: person.company_definite ?? person.company_inferred ?? card?.current_employer ?? '',
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
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  // live pass telemetry: the pass runs under a client-minted run id whose
  // activity trail this card polls while the POST is in flight
  const [researchLines, setResearchLines] = useState<LogLine[]>([]);
  const [researchPct, setResearchPct] = useState(15);
  const researchRunRef = useRef<string | null>(null);
  const seenActRef = useRef<Set<string>>(new Set());
  const lastLineAtRef = useRef(0);

  const researchAgain = async () => {
    const runId = crypto.randomUUID().replace(/-/g, '');
    researchRunRef.current = runId;
    seenActRef.current = new Set();
    lastLineAtRef.current = Date.now();
    setResearchLines([
      logLine('info', 'pass sent, grounded web search starting (name + company only)…'),
    ]);
    setResearchPct(15);
    setResearching(true);
    setResearchError(null);
    const err = await onResearchAgain(person.tg_id, runId);
    setResearchPct(100);
    setResearching(false);
    if (err) setResearchError(`research failed: ${err}`);
  };

  // poll this pass's activity trail while it runs; heartbeat when quiet
  useEffect(() => {
    if (!researching) return;
    const timer = window.setInterval(async () => {
      const runId = researchRunRef.current;
      if (!runId) return;
      try {
        const res = await fetch(`${AGENTS_URL}/activity?run_id=${runId}`);
        if (!res.ok) return;
        const entries = (await res.json()) as ActivityEntry[];
        for (const e of entries) {
          const key = `${e.ts}|${e.status}|${e.detail ?? ''}`;
          if (seenActRef.current.has(key)) continue;
          seenActRef.current.add(key);
          lastLineAtRef.current = Date.now();
          const level = e.status === 'ok' ? 'ok' : e.status === 'rejected' ? 'warn' : 'error';
          setResearchLines((l) => appendLog(l, [logLine(level, e.detail ?? e.status)]));
          if ((e.detail ?? '').includes('grounded search finished')) setResearchPct(65);
        }
      } catch {
        /* transient — keep polling */
      }
      if (Date.now() - lastLineAtRef.current > RESEARCH_HEARTBEAT_MS) {
        lastLineAtRef.current = Date.now();
        setResearchLines((l) =>
          appendLog(l, [logLine('info', 'still working… a busy model can take up to a minute')]),
        );
      }
    }, RESEARCH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [researching]);

  // your chat history with this person, straight from the local IndexedDB —
  // null when this browser has no import (e.g. a different device)
  const [chatMeta, setChatMeta] = useState<ChatMeta | null>(null);

  // reset edit state when the panel switches person
  useEffect(() => {
    setEditing(false);
    setSaveError(null);
    setNotFound(false);
    setResearchError(null);
    setChatMeta(null);
    getChatMeta(person.tg_id)
      .then((m) => setChatMeta(m ?? null))
      .catch(() => setChatMeta(null));
  }, [person.tg_id]);

  // the diff baseline is FROZEN at the moment Edit opens — load() refreshes
  // (a finishing research pass) must not silently re-baseline a live form
  const baselineRef = useRef<CorrectionForm>(initial);
  const startEdit = () => {
    baselineRef.current = initial;
    setForm(initial);
    setSaveError(null);
    setEditing(true);
  };

  // only changed AND non-empty fields are posted
  const corrections = useMemo(() => {
    const out: Record<string, string> = {};
    for (const { key } of [...FIELDS, ...TEXT_FIELDS]) {
      const v = form[key].trim();
      if (v !== '' && v !== baselineRef.current[key].trim()) out[key] = v;
    }
    return out;
  }, [form]);

  const cardMissing = !card || notFound;
  const saveDisabled = saveBusy || cardMissing || Object.keys(corrections).length === 0;

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
    <div className="flex flex-col gap-3 border-t border-emerald-900/40 glass-deep px-3 py-4 sm:px-4">
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
            <span className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => void researchAgain()}
                disabled={researching}
                title="Run one more grounded pass; changes land in the card's changelog"
                className="rounded-md border border-emerald-800 bg-emerald-950/40 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-900/50 disabled:opacity-50"
              >
                {researching ? 'Researching…' : '↻ Research again'}
              </button>
              <button
                type="button"
                onClick={startEdit}
                disabled={researching}
                className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-emerald-700 hover:text-emerald-300 disabled:opacity-50"
              >
                ✎ Edit
              </button>
            </span>
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
      {researchError && <p className="text-xs text-rose-400">{researchError}</p>}
      {researching && (
        <div className="flex flex-col gap-2 rounded-lg border border-emerald-900/50 glass p-3">
          <div className="flex items-center justify-between text-xs text-emerald-200">
            <span>
              {researchPct < 65 ? 'grounded web search running…' : 'extracting facts…'}
            </span>
            <span className="tabular-nums text-emerald-400/80">{researchPct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full animate-pulse rounded-full bg-emerald-500 transition-[width] duration-500"
              style={{ width: `${researchPct}%` }}
            />
          </div>
          <RunLog lines={researchLines} emptyText="Waiting for the first step…" />
          <p className="text-[11px] text-slate-500">
            Whatever changes lands in Card updates with old and new values.
          </p>
        </div>
      )}

      {editing ? (
        <div className="rounded-lg border border-emerald-900/60 glass p-4">
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
          {/* balanced body: a narrow identity rail, then narrative and
              evidence sharing the width — long lists (updates, sources) go
              FULL-WIDTH below so no column ever towers over empty space */}
          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-[280px_1fr_1fr]">
            <div className="flex flex-col gap-1.5 rounded-lg border border-slate-800 glass p-4">
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

              {/* your own history with this person — local IndexedDB data,
                  never from a model; distilled-row fallback on other devices */}
              <div className="mt-2 flex flex-col gap-1 border-t border-slate-800/60 pt-2.5 text-[11px] text-slate-500">
                <span className="font-medium uppercase tracking-wide text-slate-600">
                  Telegram
                </span>
                <span className="tabular-nums">
                  {(chatMeta?.msgCount ?? person.msg_volume).toLocaleString()} messages
                  {chatMeta &&
                    ` · you ${chatMeta.myCount.toLocaleString()} / them ${chatMeta.theirCount.toLocaleString()}`}
                </span>
                <span>
                  {[
                    chatMeta?.firstDate && `since ${new Date(chatMeta.firstDate).getFullYear()}`,
                    (person.last_contact ?? chatMeta?.lastDate) &&
                      `last message ${relTime((person.last_contact ?? chatMeta?.lastDate)!)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {card && (
                  <span className="text-slate-600">researched {relTime(card.created_at)}</span>
                )}
              </div>
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
            </div>
          </div>

          {card && (card.updates?.length ?? 0) > 0 && (
            <Section
              label={`Card updates · ${card.updates![0].at.slice(0, 10)}`}
              count={card.updates!.length}
            >
              <div className="space-y-1">
                {card.updates!.map((u, i) => (
                  <UpdateRow key={i} u={u} />
                ))}
              </div>
            </Section>
          )}

          {card && card.citations.length > 0 && (
            <Section label="All sources" count={card.citations.length}>
              <ul className="mt-1 grid gap-x-6 gap-y-0.5 sm:grid-cols-2 xl:grid-cols-3">
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

        </>
      )}
    </div>
  );
}
