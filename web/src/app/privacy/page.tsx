'use client';

// The privacy manifest — the data boundary as architecture, always current.
// Mirrors SPEC-HACKATHON "Data boundary" item 5 verbatim in structure.

import Link from 'next/link';
import { useState } from 'react';
import { clearAll } from '@/lib/db';
import { DistilledBadge, LocalBadge } from '@/components/Badges';

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? '/agents';

function Section({
  title,
  tone,
  badge,
  items,
}: {
  title: string;
  tone: 'amber' | 'sky' | 'emerald';
  badge?: React.ReactNode;
  items: React.ReactNode[];
}) {
  const toneClass = {
    amber: 'border-amber-900/60',
    sky: 'border-sky-900/60',
    emerald: 'border-emerald-900/60',
  }[tone];
  return (
    <section className={`rounded-lg border ${toneClass} glass p-5`}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100">
        {title}
        {badge}
      </h2>
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-300">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </section>
  );
}

type DeleteState =
  | { phase: 'idle' }
  | { phase: 'confirm' }
  | { phase: 'working' }
  | { phase: 'done'; localOk: boolean; serverOk: boolean };

export default function PrivacyPage() {
  const [del, setDel] = useState<DeleteState>({ phase: 'idle' });

  const deleteEverything = async () => {
    setDel({ phase: 'working' });
    const [localRes, serverRes] = await Promise.allSettled([
      clearAll(),
      fetch(`${AGENTS_URL}/data`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      }),
    ]);
    try {
      // the wizard must land back on step 1 — no stale "done" state
      window.localStorage.removeItem('kw-wizard-step');
    } catch {
      /* ignore */
    }
    setDel({
      phase: 'done',
      localOk: localRes.status === 'fulfilled',
      serverOk: serverRes.status === 'fulfilled',
    });
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Privacy manifest</h1>
        <p className="mt-1 text-sm text-slate-400">
          The data boundary is enforced by architecture, not promises. This screen is always
          current.
        </p>
      </div>

      <Section
        title="What leaves your browser"
        tone="amber"
        items={[
          <span key="refine">
            <span className="text-slate-100">Distill batches</span> to the Gemini API via our
            agent service, <span className="text-amber-300">transient</span>: a batch goes in,
            distilled rows come out, the batch is discarded.
          </span>,
          <span key="search">
            <span className="text-slate-100">Name + company</span> as search queries during
            enrichment.
          </span>,
          <span key="jobs">
            <span className="text-slate-100">Company names</span> to public job boards.
          </span>,
        ]}
      />

      <Section
        title="What is stored"
        tone="sky"
        badge={<DistilledBadge />}
        items={[
          <span key="rows">
            The distilled rows you can see and delete: name, tg_id, company (definite and
            inferred, never merged), role guess, closeness, a short summary.
          </span>,
        ]}
      />

      <Section
        title="What is never stored"
        tone="emerald"
        badge={<LocalBadge />}
        items={[
          <span key="msgs">
            <span className="text-slate-100">Your messages</span>, server-side, ever. The raw
            export is parsed in this tab and lives only in your browser’s IndexedDB.
          </span>,
        ]}
      />

      <p className="text-xs text-slate-500">
        Google API terms: on the paid / Cloud tier, prompts and responses sent to the Gemini API
        are not used to train Google’s models.
      </p>

      <AccountSection />

      <section className="rounded-lg border border-rose-900/60 bg-rose-950/20 p-5">
        <h2 className="mb-2 text-sm font-semibold text-rose-300">Danger zone</h2>
        <p className="mb-3 text-xs text-slate-400">
          Deletes the local IndexedDB copy of your export <em>and</em> every distilled row on the
          server (<code className="font-mono">DELETE {AGENTS_URL}/data</code>).
        </p>

        {del.phase === 'idle' && (
          <button
            type="button"
            onClick={() => setDel({ phase: 'confirm' })}
            className="rounded-md border border-rose-800 bg-rose-950/60 px-4 py-2 text-sm font-medium text-rose-300 hover:bg-rose-900/60"
          >
            Delete everything
          </button>
        )}

        {del.phase === 'confirm' && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-rose-200">
              Really delete everything? This cannot be undone.
            </span>
            <button
              type="button"
              onClick={() => void deleteEverything()}
              className="rounded-md bg-rose-700 px-4 py-2 text-sm font-medium text-white hover:bg-rose-600"
            >
              Yes, delete it all
            </button>
            <button
              type="button"
              onClick={() => setDel({ phase: 'idle' })}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500"
            >
              Cancel
            </button>
          </div>
        )}

        {del.phase === 'working' && (
          <div className="flex items-center gap-2.5 text-sm text-slate-400">
            <span
              aria-hidden
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-slate-300"
            />
            Deleting… A bigger database takes a little while, hold on.
          </div>
        )}

        {del.phase === 'done' && (
          <div className="flex flex-col gap-2 text-sm">
            <p
              className={`text-base font-semibold ${
                del.localOk && del.serverOk ? 'text-emerald-300' : 'text-amber-300'
              }`}
            >
              {del.localOk && del.serverOk ? '✓ Deleted.' : 'Partly deleted'}
            </p>
            <span className={del.localOk ? 'text-emerald-400' : 'text-rose-400'}>
              {del.localOk
                ? '✓ Local data cleared (IndexedDB).'
                : '✗ Failed to clear local data. Try again.'}
            </span>
            <span className={del.serverOk ? 'text-emerald-400' : 'text-rose-400'}>
              {del.serverOk
                ? '✓ Server rows deleted.'
                : '✗ Server delete failed. Is the agents service running?'}
            </span>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Link
                href="/"
                className="rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
              >
                Start onboarding again →
              </Link>
              <button
                type="button"
                onClick={() => setDel({ phase: 'idle' })}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-500"
              >
                OK
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}


/** Account — change (or, for Google-created accounts, set) the password.
 *  There is no email reset in this hackathon build: the sign-in form says
 *  so honestly, and this is the one place a signed-in owner manages it. */
function AccountSection() {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`${AGENTS_URL}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
      });
      const body = (await res.json().catch(() => null)) as {
        detail?: unknown;
        had_password?: boolean;
      } | null;
      if (!res.ok) {
        throw new Error(
          typeof body?.detail === 'string' ? body.detail : `HTTP ${res.status}`,
        );
      }
      setResult({
        ok: true,
        text: body?.had_password
          ? '✓ Password changed. Use the new one next time you sign in.'
          : '✓ Password set. You can now sign in with email + password too.',
      });
      setOldPw('');
      setNewPw('');
    } catch (err) {
      setResult({
        ok: false,
        text: err instanceof Error ? err.message : 'password change failed',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-slate-800 glass p-5">
      <h2 className="mb-2 text-sm font-semibold text-slate-100">Account</h2>
      <p className="mb-3 text-xs text-slate-400">
        Change your password here. Signed up with Google and have no password yet?
        Leave the current one empty to set your first. There is no email reset in
        this hackathon build — this page is the only place to manage it.
      </p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">
            Current password
          </span>
          <input
            type="password"
            autoComplete="current-password"
            value={oldPw}
            onChange={(e) => setOldPw(e.target.value)}
            placeholder="empty if none yet"
            className="w-52 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">
            New password
          </span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="at least 8 characters"
            className="w-52 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={busy || newPw.length < 8}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? '…' : 'Change password'}
        </button>
      </form>
      {result && (
        <p className={`mt-3 text-xs ${result.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
          {result.text}
        </p>
      )}
    </section>
  );
}
