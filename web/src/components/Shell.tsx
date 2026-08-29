'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { PrivacyModeToggle } from '@/components/PrivacyModeToggle';

const NAV = [
  { href: '/', label: 'Onboarding' },
  { href: '/raw', label: 'Raw Table' },
  { href: '/refine', label: 'Refine' },
  { href: '/people', label: 'People' },
  { href: '/privacy', label: 'Privacy' },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <div className="flex items-baseline gap-3">
          <Link href="/" className="text-lg font-semibold tracking-tight text-slate-100">
            Knownworld
          </Link>
          <span className="text-xs text-slate-500">this is my known world</span>
        </div>
        <PrivacyModeToggle />
      </header>

      <div className="flex flex-1">
        <aside className="w-44 shrink-0 border-r border-slate-800 py-4">
          <nav className="flex flex-col gap-0.5 px-2">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-2 text-sm transition-colors ${
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

        <main className="min-w-0 flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
