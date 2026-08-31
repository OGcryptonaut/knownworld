'use client';

// Brief-intent answer: the composed deliverable (meeting questions, custdev
// scripts, plans) as titled sections, plus the contacts it is grounded on —
// each linking to their card in the Database.

import Link from 'next/link';
import type { RequestResult } from '@/lib/types';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';

export function BriefResult({ result }: { result: RequestResult }) {
  const { masked } = usePrivacy();
  const sections = result.sections ?? [];

  return (
    <div className="flex flex-col gap-3">
      {sections.map((s, i) => (
        <div key={i} className="rounded-lg border border-slate-800 glass p-4">
          <span className="inline-flex max-w-full items-baseline border-l-[3px] border-emerald-500 bg-emerald-500/10 py-0.5 pl-2 pr-2.5">
            <span className="min-w-0 truncate text-xs font-medium text-emerald-300">
              {s.title}
            </span>
          </span>
          <ul className="mt-2 flex flex-col gap-1">
            {s.body
              .split('\n')
              .filter((line) => line.trim() !== '')
              .map((line, j) => (
                <li key={j} className="flex gap-2 text-sm text-slate-300">
                  <span className="text-emerald-500/70">•</span>
                  <span className="min-w-0 break-words">{line.replace(/^[-•]\s*/, '')}</span>
                </li>
              ))}
          </ul>
        </div>
      ))}

      {result.matches.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-slate-600">
            grounded on
          </span>
          {result.matches.map((m) =>
            m.name.trim() === '' ? (
              <span
                key={m.tg_id}
                className="inline-flex items-center rounded-full border border-slate-800 bg-slate-950/60 px-2 py-0.5 text-[11px] text-slate-600"
              >
                (unnamed)
              </span>
            ) : (
              <Link
                key={m.tg_id}
                href={`/database?person=${m.tg_id}`}
                title={m.reason}
                className="inline-flex items-center gap-1 rounded-full border border-emerald-800 bg-emerald-950/50 px-2 py-0.5 text-[11px] text-emerald-300 hover:border-emerald-600 hover:bg-emerald-900/50"
              >
                <span className="max-w-[160px] truncate">{displayName(m.name, masked)}</span>
                <span className="tabular-nums text-emerald-500">{Math.round(m.closeness)}</span>
              </Link>
            ),
          )}
        </div>
      )}
    </div>
  );
}
