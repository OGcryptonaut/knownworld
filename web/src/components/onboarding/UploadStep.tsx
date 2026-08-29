'use client';

// Wizard step 1 — export instructions, client-side ingest (streamed →
// IndexedDB; the raw export never leaves the browser), and the role-fit
// profile that later filters the job run.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IngestProgress, IngestSummary, RoleFitProfile } from '@/lib/types';
import { DEFAULT_ROLE_FIT } from '@/lib/types';
import { getIngestSummary, clearAll } from '@/lib/db';
import { ingestFile, ingestFromDevServer } from '@/lib/ingest';
import { LocalBadge } from '@/components/Badges';

const ROLEFIT_KEY = 'kw-rolefit';

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function ChipEditor({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const t = draft.trim();
    if (t && !values.includes(t)) onChange([...values, t]);
    setDraft('');
  };

  return (
    <div>
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-200"
          >
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-slate-500 hover:text-rose-400"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="add…"
          className="w-24 rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
        />
      </div>
    </div>
  );
}

export function UploadStep({ onContinue }: { onContinue: () => void }) {
  const [summary, setSummary] = useState<IngestSummary | undefined>(undefined);
  const [summaryChecked, setSummaryChecked] = useState(false);
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [devAvailable, setDevAvailable] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [rolefit, setRolefit] = useState<RoleFitProfile>(DEFAULT_ROLE_FIT);
  const [rolefitLoaded, setRolefitLoaded] = useState(false);

  useEffect(() => {
    getIngestSummary()
      .then((s) => setSummary(s))
      .catch(() => {})
      .finally(() => setSummaryChecked(true));

    fetch('/api/dev/export', { method: 'HEAD' })
      .then((r) => setDevAvailable(r.ok))
      .catch(() => setDevAvailable(false));

    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        const raw = window.localStorage.getItem(ROLEFIT_KEY);
        if (raw)
          setRolefit({ ...DEFAULT_ROLE_FIT, ...(JSON.parse(raw) as Partial<RoleFitProfile>) });
      } catch {
        /* ignore corrupt profile */
      }
      setRolefitLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!rolefitLoaded) return;
    try {
      window.localStorage.setItem(ROLEFIT_KEY, JSON.stringify(rolefit));
    } catch {
      /* ignore */
    }
  }, [rolefit, rolefitLoaded]);

  const runIngest = useCallback(
    async (run: () => Promise<IngestSummary>) => {
      if (ingesting) return;
      setIngesting(true);
      setError(null);
      setProgress(null);
      try {
        const s = await run();
        setSummary(s);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Import failed.');
      } finally {
        setIngesting(false);
      }
    },
    [ingesting],
  );

  const handleFile = useCallback(
    (file: File) => runIngest(() => ingestFile(file, (p) => setProgress(p))),
    [runIngest],
  );

  const handleDev = useCallback(
    () => runIngest(() => ingestFromDevServer((p) => setProgress(p))),
    [runIngest],
  );

  const pct =
    progress && progress.bytesTotal > 0
      ? Math.min(100, (progress.bytesRead / progress.bytesTotal) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-100">Upload your chats</h2>
        <p className="text-sm text-slate-300">
          In <span className="text-slate-100">Telegram Desktop</span>: Settings → Advanced →{' '}
          <span className="text-slate-100">Export Telegram data</span> → pick{' '}
          <span className="text-slate-100">Machine-readable JSON</span> (untick media — only text
          is used). You end up with{' '}
          <code className="font-mono text-slate-400">result.json</code>.
        </p>

        {!summaryChecked ? (
          <p className="mt-4 text-sm text-slate-500">Checking local data…</p>
        ) : (
          <>
            {summary && !ingesting && (
              <div className="mt-4 rounded-md border border-emerald-900 bg-emerald-950/30 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-emerald-300">
                  Import complete <LocalBadge />
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-slate-500">Chats</dt>
                    <dd className="tabular-nums text-slate-100">
                      {summary.totalChats.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Personal</dt>
                    <dd className="tabular-nums text-slate-100">
                      {summary.personalChats.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Messages</dt>
                    <dd className="tabular-nums text-slate-100">
                      {summary.totalMessages.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">File</dt>
                    <dd className="text-slate-100">{formatBytes(summary.fileSize)}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      void clearAll().then(() => setSummary(undefined));
                    }}
                    className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:border-rose-800 hover:text-rose-400"
                  >
                    Clear local data
                  </button>
                  <span className="text-xs text-slate-500">Re-import replaces local data.</span>
                </div>
              </div>
            )}

            <div
              role="button"
              tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleFile(f);
              }}
              className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-6 py-8 text-center transition-colors ${
                dragActive
                  ? 'border-emerald-500 bg-emerald-950/30'
                  : 'border-slate-700 bg-slate-950/40 hover:border-slate-500'
              }`}
            >
              <p className="text-sm text-slate-300">
                Drop <code className="font-mono">result.json</code> here, or click to choose
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Parsed as a stream in this tab — works on multi-GB exports
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = '';
                }}
              />
            </div>

            {devAvailable && !ingesting && (
              <button
                type="button"
                onClick={handleDev}
                className="mt-2 text-xs text-slate-500 underline decoration-slate-700 underline-offset-2 hover:text-slate-300"
              >
                Load dev corpus (local file, dev only)
              </button>
            )}

            {progress && (progress.phase === 'parsing' || progress.phase === 'storing' || ingesting) && (
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                  <span className="capitalize">{progress.phase}…</span>
                  <span className="tabular-nums">
                    {formatBytes(progress.bytesRead)} / {formatBytes(progress.bytesTotal)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-[width] duration-200"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-1.5 flex gap-4 text-xs tabular-nums text-slate-500">
                  <span>{progress.chatsSeen.toLocaleString()} chats</span>
                  <span>{progress.messagesSeen.toLocaleString()} messages</span>
                </div>
              </div>
            )}

            {error && (
              <p className="mt-3 rounded-md border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
                {error}
              </p>
            )}
          </>
        )}

        <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
          <LocalBadge />
          Your export is parsed in this tab and stored in your browser (IndexedDB). Nothing has
          left your machine.
        </p>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-sm font-semibold text-slate-100">Role-fit profile</h2>
        <p className="mb-4 mt-1 text-xs text-slate-500">
          Later stages filter jobs and warm paths against this. Edit freely — saved locally.
        </p>
        <div className="flex flex-col gap-4">
          <ChipEditor
            label="Target roles"
            values={rolefit.targetRoles}
            onChange={(v) => setRolefit({ ...rolefit, targetRoles: v })}
          />
          <ChipEditor
            label="Industries"
            values={rolefit.industries}
            onChange={(v) => setRolefit({ ...rolefit, industries: v })}
          />
          <ChipEditor
            label="Seniority"
            values={rolefit.seniority}
            onChange={(v) => setRolefit({ ...rolefit, seniority: v })}
          />
          <div>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
              Location
            </div>
            <input
              value={rolefit.location}
              onChange={(e) => setRolefit({ ...rolefit, location: e.target.value })}
              className="w-full max-w-sm rounded-md border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-emerald-600 focus:outline-none"
            />
          </div>
        </div>
      </section>

      <div className="flex items-center justify-end gap-3">
        {!summary && summaryChecked && (
          <span className="text-xs text-slate-500">Load an export to continue</span>
        )}
        <button
          type="button"
          onClick={onContinue}
          disabled={!summary || ingesting}
          className="rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
