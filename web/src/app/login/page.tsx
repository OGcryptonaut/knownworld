'use client';

// The login page is the product's one-page landing: full-height hero over the
// world-map constellation, the sign-in card, and a three-step story. Copy is
// short and human. Set NEXT_PUBLIC_VIDEO_URL to light up the explainer button.

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthForm } from '@/components/AuthForm';
import { LandingMap } from '@/components/LandingMap';
import { ThemeToggle } from '@/components/ThemeProvider';
import { Logo } from '@/components/Logo';

const VIDEO_URL = process.env.NEXT_PUBLIC_VIDEO_URL ?? '';

function Step({
  n,
  title,
  text,
  icon,
}: {
  n: number;
  title: string;
  text: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-slate-800 glass p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-950/70 text-emerald-400">
          {icon}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Step {n}
        </span>
      </div>
      <h3 className="text-base font-semibold text-slate-100">{title}</h3>
      <p className="text-sm leading-relaxed text-slate-400">{text}</p>
    </div>
  );
}

function Landing() {
  const params = useSearchParams();
  const [mode, setMode] = useState<'login' | 'signup'>(
    params.get('mode') === 'signup' ? 'signup' : 'login',
  );
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950">
      {/* map constellation behind the hero */}
      <div className="pointer-events-none absolute inset-x-0 top-8 flex justify-center opacity-60 sm:top-0 sm:opacity-70">
        <LandingMap className="mt-10 w-[min(1400px,160vw)] max-w-none sm:w-[min(1400px,105vw)]" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-4 pb-10 sm:px-8">
        {/* top bar */}
        <header className="flex items-center justify-between py-5">
          <div className="flex items-center gap-2.5">
            <Logo size={26} />
            <span className="text-lg font-semibold tracking-tight text-slate-100">Knownworld</span>
          </div>
          <ThemeToggle />
        </header>

        {/* hero fills the first screen */}
        <div className="grid flex-1 content-center items-center gap-10 py-10 lg:grid-cols-[1.2fr_380px] lg:gap-16">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight text-slate-100 sm:text-5xl xl:text-6xl">
              Your network already knows the way in.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-400 sm:text-lg">
              Ten years of chats hide a hundred open doors. Knownworld maps the people you
              actually know, finds out who they became, and turns that into warm intros
              to jobs, partners and the right person in any city. Your raw chats never
              leave your browser.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a
                href={VIDEO_URL || '#'}
                target={VIDEO_URL ? '_blank' : undefined}
                rel="noopener noreferrer"
                aria-disabled={!VIDEO_URL}
                className={`inline-flex items-center gap-2.5 rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors ${
                  VIDEO_URL
                    ? 'border-emerald-700 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/50'
                    : 'cursor-default border-slate-800 text-slate-500'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5v14l11-7z" />
                </svg>
                {VIDEO_URL ? 'Watch the 3 minute story' : 'Video story is on its way'}
              </a>
              <span className="text-xs text-slate-500">
                open source, runs in your own cloud
              </span>
            </div>
          </div>

          {/* auth card — switches between sign in / create account in place */}
          <div className="w-full justify-self-center lg:justify-self-end">
            <AuthForm mode={mode} embedded onSwitchMode={setMode} />
          </div>
        </div>

        {/* three steps */}
        <div className="grid gap-4 py-6 sm:grid-cols-2 lg:grid-cols-3">
          <Step
            n={1}
            title="Bring your chats"
            text="Drop your Telegram export. It parses right in your browser, and the agents turn years of noise into clean cards for the people who matter."
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="M7 10l5-5 5 5" />
                <path d="M12 5v12" />
              </svg>
            }
          />
          <Step
            n={2}
            title="See your world"
            text="One database, three views. A map of where everyone lives, a graph of who clusters where, and researched cards you can edit like your own notebook."
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="2.5" />
                <circle cx="5" cy="6" r="2" />
                <circle cx="19" cy="6" r="2" />
                <circle cx="5" cy="18" r="2" />
                <circle cx="19" cy="18" r="2" />
                <path d="M6.7 7.2 10.3 10.6M17.3 7.2 13.7 10.6M6.7 16.8 10.3 13.4M17.3 16.8 13.7 13.4" />
              </svg>
            }
          />
          <Step
            n={3}
            title="Put it to work"
            text="Ask in plain words. Live openings where your people work, who to meet at next week's conference, the warmest path to each door. Answers come from your own network."
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
              </svg>
            }
          />
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/70 pt-5 text-xs text-slate-500">
          <span>Raw chats stay in your browser. Distilled rows live in your own account.</span>
          <span>Gemini + ADK on Google Cloud</span>
        </footer>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <Landing />
    </Suspense>
  );
}
