'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageBackdrop, type BackdropVariant } from '@/components/PageBackdrop';
import { PrivacyModeToggle } from '@/components/PrivacyModeToggle';
import { ThemeToggle } from '@/components/ThemeProvider';

// v2 — three product pages + the privacy manifest. Legacy pages stay
// routable (deep links, demos) but out of the nav.
const NAV = [
  { href: '/', label: 'Onboarding' },
  { href: '/database', label: 'Database' },
  { href: '/requests', label: 'Requests' },
  { href: '/privacy', label: 'Privacy' },
] as const;

const BARE_PATHS = new Set(['/login', '/signup']);

// one ambient backdrop per page, themed to what the page does (the landing
// has its own world-map hero and stays as-is)
const BACKDROPS: Record<string, BackdropVariant> = {
  '/': 'wizard',
  '/database': 'database',
  '/requests': 'requests',
  '/privacy': 'privacy',
};

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  if (BARE_PATHS.has(pathname)) return <>{children}</>;

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  };

  const backdrop = BACKDROPS[pathname];

  return (
    <div className="flex min-h-screen flex-col">
      {backdrop && <PageBackdrop variant={backdrop} />}
      <header className="glass sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-slate-800/70 px-3 py-3 sm:px-6">
        <div className="flex items-baseline gap-3">
          <Link href="/" className="text-lg font-semibold tracking-tight text-slate-100">
            Knownworld
          </Link>
          <span className="hidden text-xs text-slate-500 md:inline">this is my known world</span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <PrivacyModeToggle />
          <button
            type="button"
            onClick={signOut}
            className="rounded-md border border-slate-800 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col md:flex-row">
        <aside className="shrink-0 border-b border-slate-800 md:w-44 md:border-b-0 md:border-r md:py-4">
          <nav className="flex gap-0.5 overflow-x-auto px-2 py-2 md:flex-col md:overflow-visible md:py-0">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors ${
                    active
                      ? 'bg-slate-800/70 font-medium text-emerald-400'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 px-3 py-4 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
