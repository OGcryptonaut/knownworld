'use client';

// v2 — shared login/signup form. Posts same-origin to /api/auth/*; the
// session lands in an httpOnly cookie, so no token ever lives in JS.

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { clearAll } from '@/lib/db';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';
const GSI_SRC = 'https://accounts.google.com/gsi/client';

type GoogleCredentialResponse = { credential: string };
interface GoogleIdApi {
  accounts: {
    id: {
      initialize: (cfg: {
        client_id: string;
        callback: (r: GoogleCredentialResponse) => void;
      }) => void;
      renderButton: (el: HTMLElement, cfg: Record<string, unknown>) => void;
    };
  };
}

export function AuthForm({
  mode,
  embedded = false,
  onSwitchMode,
}: {
  mode: 'login' | 'signup';
  embedded?: boolean;
  /** when provided, the footer link switches the card in place (no navigation) */
  onSwitchMode?: (mode: 'login' | 'signup') => void;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the honest no-email-reset note: always reachable via the link, and
  // surfaced automatically the moment a sign-in actually fails
  const [showForgot, setShowForgot] = useState(false);
  const googleDivRef = useRef<HTMLDivElement | null>(null);

  const isSignup = mode === 'signup';

  const startClean = async () => {
    // a NEW account starts clean: the browser-wide IndexedDB (previous
    // user's raw chats) and wizard progress must not leak across accounts
    try {
      await clearAll();
      window.localStorage.removeItem('kw-wizard-step');
    } catch {
      /* non-fatal */
    }
  };

  const finishSignIn = () => {
    router.push(params.get('next') ?? '/');
    router.refresh();
  };

  // Sign in with Google: the GIS button posts its ID token to our bridge,
  // which verifies it server-side and sets the same httpOnly session cookie
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const render = () => {
      const google = (window as unknown as { google?: GoogleIdApi }).google;
      if (!google || !googleDivRef.current) return;
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (resp: GoogleCredentialResponse) => {
          void (async () => {
            setError(null);
            try {
              const res = await fetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: resp.credential }),
              });
              if (!res.ok) {
                const body = (await res.json().catch(() => null)) as {
                  detail?: unknown;
                } | null;
                throw new Error(
                  typeof body?.detail === 'string'
                    ? body.detail
                    : `Google sign-in failed (HTTP ${res.status})`,
                );
              }
              const session = (await res.json()) as { created?: boolean };
              if (session.created) await startClean();
              finishSignIn();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Google sign-in failed');
            }
          })();
        },
      });
      google.accounts.id.renderButton(googleDivRef.current, {
        theme: 'outline',
        size: 'large',
        width: 320,
        text: isSignup ? 'signup_with' : 'signin_with',
      });
    };
    const existing = document.querySelector(`script[src="${GSI_SRC}"]`);
    if (existing) {
      render();
      existing.addEventListener('load', render, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
    // the script stays for the page's lifetime — no cleanup needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignup]);

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
      if (isSignup) await startClean();
      finishSignIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'something went wrong');
      // a failed sign-in is exactly when the no-reset note matters
      if (!isSignup) setShowForgot(true);
      setBusy(false);
    }
  };

  const form = (
    <>
        <form
          onSubmit={submit}
          className="rounded-xl border border-slate-800 glass p-6"
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

          {!isSignup && showForgot && (
            <div className="mb-3 rounded-md border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-xs leading-relaxed text-amber-200">
              <span className="font-medium">Forgot your password?</span> This is a
              hackathon build without email infrastructure, so there is no reset
              link. If you signed up with Google, use the Google button below.
              Otherwise, please create a new account — every account keeps its own
              data, nothing else is affected.
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? '…' : isSignup ? 'Create account' : 'Sign in'}
          </button>

          {!isSignup && !showForgot && (
            <p className="mt-2 text-center">
              <button
                type="button"
                onClick={() => setShowForgot(true)}
                className="text-xs text-slate-500 underline decoration-dotted hover:text-slate-300"
              >
                Forgot your password?
              </button>
            </p>
          )}

          {GOOGLE_CLIENT_ID && (
            <>
              <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-slate-600">
                <span className="h-px flex-1 bg-slate-800" />
                or
                <span className="h-px flex-1 bg-slate-800" />
              </div>
              <div ref={googleDivRef} className="flex justify-center" />
            </>
          )}

          <p className="mt-4 text-center text-xs text-slate-500">
            {isSignup ? (
              <>
                Already have an account?{' '}
                {onSwitchMode ? (
                  <button
                    type="button"
                    onClick={() => onSwitchMode('login')}
                    className="text-emerald-400 hover:text-emerald-300"
                  >
                    Sign in
                  </button>
                ) : (
                  <Link href="/login" className="text-emerald-400 hover:text-emerald-300">
                    Sign in
                  </Link>
                )}
              </>
            ) : (
              <>
                New here?{' '}
                {onSwitchMode ? (
                  <button
                    type="button"
                    onClick={() => onSwitchMode('signup')}
                    className="text-emerald-400 hover:text-emerald-300"
                  >
                    Create an account
                  </button>
                ) : (
                  <Link href="/signup" className="text-emerald-400 hover:text-emerald-300">
                    Create an account
                  </Link>
                )}
              </>
            )}
          </p>
        </form>

        <p className="mt-6 text-center text-xs leading-relaxed text-slate-600">
          Your contacts live in your own account. Raw chats never leave your browser.
        </p>
    </>
  );

  if (embedded) return <div className="w-full max-w-sm">{form}</div>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Knownworld</h1>
        </div>
        {form}
      </div>
    </div>
  );
}
