'use client';

// v2 — shared login/signup form. Posts same-origin to /api/auth/*; the
// session lands in an httpOnly cookie, so no token ever lives in JS.

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { clearAll } from '@/lib/db';

export function AuthForm({ mode, embedded = false }: { mode: 'login' | 'signup'; embedded?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === 'signup';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
        throw new Error(
          typeof body?.detail === 'string'
            ? body.detail
            : `something went wrong (HTTP ${res.status})`,
        );
      }
      if (isSignup) {
        // a NEW account starts clean: the browser-wide IndexedDB (previous
        // user's raw chats) and wizard progress must not leak across accounts
        try {
          await clearAll();
          window.localStorage.removeItem('kw-wizard-step');
        } catch {
          /* non-fatal */
        }
      }
      router.push(params.get('next') ?? '/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'something went wrong');
      setBusy(false);
    }
  };

  const form = (
    <>
        <form
          onSubmit={submit}
          className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl shadow-black/30"
        >
          <h2 className="mb-4 text-sm font-semibold text-slate-100">
            {isSignup ? 'Create your account' : 'Welcome back'}
          </h2>

          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Email
            </span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
              placeholder="you@example.com"
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Password
            </span>
            <input
              type="password"
              required
              minLength={isSignup ? 8 : undefined}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
              placeholder={isSignup ? 'at least 8 characters' : '••••••••'}
            />
          </label>

          {error ? (
            <p className="mb-3 rounded-md border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? '…' : isSignup ? 'Create account' : 'Sign in'}
          </button>

          <p className="mt-4 text-center text-xs text-slate-500">
            {isSignup ? (
              <>
                Already have an account?{' '}
                <Link href="/login" className="text-emerald-400 hover:text-emerald-300">
                  Sign in
                </Link>
              </>
            ) : (
              <>
                New here?{' '}
                <Link href="/signup" className="text-emerald-400 hover:text-emerald-300">
                  Create an account
                </Link>
              </>
            )}
          </p>
        </form>

        <p className="mt-6 text-center text-xs leading-relaxed text-slate-600">
          Your account is the boundary: your contacts live in your own space,
          your raw chats never leave your browser.
        </p>
    </>
  );

  if (embedded) return <div className="w-full max-w-sm">{form}</div>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Knownworld</h1>
          <p className="mt-1 text-sm text-slate-500">this is my known world</p>
        </div>
        {form}
      </div>
    </div>
  );
}
