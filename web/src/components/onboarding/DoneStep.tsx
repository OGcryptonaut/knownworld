'use client';

// Wizard step 4 — the payoff screen. Counts only; names stay on /database
// (masked at render there). Stats are fetched fresh, offline-tolerant.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { DistilledPerson, EnrichmentCard } from '@/lib/types';

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? '/agents';

interface Stats {
  distilled: number;
  workRelevant: number;
  researched: number;
  pendingReview: number;
}

function StatTile({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
      <div className="text-2xl font-semibold tabular-nums text-slate-100">
        {value === null ? '—' : value.toLocaleString()}
      </div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
    </div>
  );
}

export function DoneStep() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let people: DistilledPerson[] = [];
      let cards: EnrichmentCard[] = [];
      try {
        const res = await fetch(`${AGENTS_URL}/people`);
        if (res.ok) {
          const data = (await res.json()) as DistilledPerson[];
          if (Array.isArray(data)) people = data;
        }
      } catch {
        /* offline — tiles show em dashes via null stats below */
      }
      try {
        const res = await fetch(`${AGENTS_URL}/enrichments`);
        if (res.ok) {
          const data = (await res.json()) as EnrichmentCard[];
          if (Array.isArray(data)) cards = data;
        }
      } catch {
        /* ignore */
      }
      if (cancelled) return;
      setStats({
        distilled: people.length,
        workRelevant: people.filter((p) => p.work_relevant).length,
        researched: cards.length,
        pendingReview: cards.filter((c) => c.status === 'pending').length,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-5">
        <h2 className="text-sm font-semibold text-emerald-300">Your known world is ready</h2>
        <p className="mt-1 text-sm text-slate-300">
          Your Telegram history is now a distilled, research-backed contact database — raw chats
          never left this browser.
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Contacts distilled" value={stats ? stats.distilled : null} />
        <StatTile label="Work-relevant" value={stats ? stats.workRelevant : null} />
        <StatTile label="Researched" value={stats ? stats.researched : null} />
        <StatTile label="Pending review" value={stats ? stats.pendingReview : null} />
      </div>

      {stats !== null && stats.pendingReview > 0 && (
        <p className="text-xs text-slate-500">
          {stats.pendingReview} research card{stats.pendingReview === 1 ? '' : 's'} await your
          approval —{' '}
          <Link href="/verify" className="text-emerald-400 hover:underline">
            review them on Verify →
          </Link>
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Link
          href="/database"
          className="rounded-md bg-emerald-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Open your database →
        </Link>
        <Link
          href="/requests"
          className="rounded-md border border-slate-700 px-6 py-2.5 text-sm text-slate-200 hover:border-emerald-700 hover:text-emerald-300"
        >
          Ask your network anything
        </Link>
      </div>
    </div>
  );
}
