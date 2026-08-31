'use client';

// Intro-intent answer: the drafted copy-out message. The app never sends
// anything anywhere — the user copies the text into Telegram themselves.

import Link from 'next/link';
import { useState } from 'react';
import type { RequestResult } from '@/lib/types';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';

export function IntroResult({ result }: { result: RequestResult }) {
  const { masked } = usePrivacy();
  const [copied, setCopied] = useState(false);

  if (!result.message || !result.intro_to) {
    const asked = typeof result.stats.person_query === 'string' ? result.stats.person_query : null;
    return (
      <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
        {asked
          ? `Could not find "${asked}" among your contacts, so nothing was drafted. Check the name and ask again.`
          : 'Name the person you want to write to ("Draft an intro to Anna…") and ask again.'}
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.message!);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the text is selectable */
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span>Draft for</span>
        <Link
          href={`/database?person=${result.intro_to.tg_id}`}
          title="Open their card in the Database"
          className="inline-flex items-center gap-1 rounded-full border border-emerald-800 bg-emerald-950/50 px-2 py-0.5 text-[11px] text-emerald-300 hover:border-emerald-600 hover:bg-emerald-900/50"
        >
          {displayName(result.intro_to.name, masked)}
          <span className="tabular-nums text-emerald-500">
            {Math.round(result.intro_to.closeness)}
          </span>
        </Link>
        {result.intro_to.company && <span>· {result.intro_to.company}</span>}
      </div>
      <p className="whitespace-pre-wrap rounded-lg border border-slate-800 glass-deep px-4 py-3 text-sm leading-relaxed text-slate-100">
        {result.message}
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded-md border border-emerald-800 bg-emerald-950/40 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-900/50"
        >
          {copied ? '✓ Copied' : 'Copy message'}
        </button>
        <span className="text-[11px] text-slate-500">
          You send it yourself from Telegram. The app never sends anything.
        </span>
      </div>
    </div>
  );
}
