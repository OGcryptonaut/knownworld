'use client';

// Wizard step 1 — export instructions and client-side ingest (streamed →
// IndexedDB; the raw export never leaves the browser). Role targeting lives
// in the request itself now, so there is no profile form here.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IngestProgress, IngestSummary } from '@/lib/types';
import { getIngestSummary, clearAll } from '@/lib/db';
import { ingestFile, ingestFromDevServer, ingestFromUrl } from '@/lib/ingest';
import { LocalBadge } from '@/components/Badges';

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
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


  useEffect(() => {
    getIngestSummary()
      .then((s) => setSummary(s))
      .catch(() => {})
      .finally(() => setSummaryChecked(true));

    fetch('/api/dev/export', { method: 'HEAD' })
      .then((r) => setDevAvailable(r.ok))
      .catch(() => setDevAvailable(false));

  }, []);

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

  // the demo dataset ships as a static asset — works in prod, one click,
  // nothing uploaded (see sample-data/README.md: openly fictional network)
  const handleDemo = useCallback(
    () => runIngest(() => ingestFromUrl('/demo-corpus.json', (p) => setProgress(p))),
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

            {!ingesting && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleDemo}
                  className="rounded-md border border-emerald-800 bg-emerald-950/40 px-3.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-900/50"
                >
                  No export handy? Try the demo network →
                </button>
                <span className="text-[11px] text-slate-500">
                  15 famous founders, openly fictional chats, real companies with live job feeds
                </span>
              </div>
            )}
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


      <div className="flex flex-wrap items-center justify-end gap-3">
        {!summary && summaryChecked && (
          <span className="text-xs text-slate-500">Load an export to continue</span>
        )}
        <button
          type="button"
          onClick={onContinue}
          disabled={!summary || ingesting}
          className="w-full rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
