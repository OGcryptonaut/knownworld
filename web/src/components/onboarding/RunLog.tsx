'use client';

// Shared live-log console for the wizard's long-running steps (Distill /
// Research). Chronological, auto-sticks to the bottom unless the user has
// scrolled up. Errors and rejections land here alongside normal telemetry —
// the log is the single honest record of what the run did.
// Contact names go in `person`, never baked into `text` — privacy display
// mode masks them at RENDER time, exactly like every table.

import { useEffect, useRef } from 'react';
import { usePrivacy } from '@/components/PrivacyProvider';
import { displayName } from '@/lib/privacy';

export type LogLevel = 'info' | 'ok' | 'warn' | 'error';

export interface LogLine {
  id: number;
  ts: string; // HH:MM:SS, display only
  level: LogLevel;
  text: string;
  /** contact name rendered before the text — masked by privacy display mode */
  person?: string;
}

const LOG_CAP = 500;
let seq = 0;

export function logLine(level: LogLevel, text: string, person?: string): LogLine {
  return {
    id: ++seq,
    ts: new Date().toLocaleTimeString([], { hour12: false }),
    level,
    text,
    person,
  };
}

/** Append lines, keeping at most LOG_CAP (oldest dropped). */
export function appendLog(prev: LogLine[], added: LogLine[]): LogLine[] {
  if (added.length === 0) return prev;
  const next = [...prev, ...added];
  return next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next;
}

const LEVEL_CLASS: Record<LogLevel, string> = {
  info: 'text-slate-400',
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  error: 'text-rose-400',
};

export function RunLog({
  lines,
  emptyText = 'No log yet.',
}: {
  lines: LogLine[];
  emptyText?: string;
}) {
  const { masked } = usePrivacy();
  const boxRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = boxRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      ref={boxRef}
      onScroll={() => {
        const el = boxRef.current;
        if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className="max-h-56 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 font-mono text-[11px] leading-5"
    >
      {lines.length === 0 ? (
        <p className="py-1 text-slate-600">{emptyText}</p>
      ) : (
        lines.map((l) => (
          <div key={l.id} className="flex gap-2">
            <span className="shrink-0 tabular-nums text-slate-600">{l.ts}</span>
            <span className={`min-w-0 break-words ${LEVEL_CLASS[l.level]}`}>
              {l.person !== undefined ? `${displayName(l.person, masked)} ${l.text}` : l.text}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
