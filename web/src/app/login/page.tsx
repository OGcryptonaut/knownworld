'use client';

// The login page is the product's one-page landing: hero (what this is + the
// video-explainer button), the world-map constellation, sign-in card, and the
// three-step story. Set NEXT_PUBLIC_VIDEO_URL to the explainer link.

import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { LandingMap } from '@/components/LandingMap';
import { ThemeToggle } from '@/components/ThemeProvider';

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
    <div className="flex flex-col items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-950/70 text-emerald-400">
          {icon}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Step {n}
        </span>
      </div>
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <p className="text-sm leading-relaxed text-slate-400">{text}</p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950">
      {/* map constellation behind the hero */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center opacity-70">
        <LandingMap className="mt-6 w-[min(1200px,110vw)]" />
      </div>

      <div className="relative mx-auto flex max-w-6xl flex-col px-6 pb-16">
        {/* top bar */}
        <header className="flex items-center justify-between py-5">
          <div className="flex items-baseline gap-3">
            <span className="text-lg font-semibold tracking-tight text-slate-100">Knownworld</span>
            <span className="hidden text-xs text-slate-500 sm:inline">
              this is my known world
            </span>
          </div>
          <ThemeToggle />
        </header>

        {/* hero */}
        <div className="mt-6 grid items-start gap-10 lg:mt-10 lg:grid-cols-[1fr_360px]">
          <div className="max-w-xl pt-4">
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-slate-100 sm:text-5xl">
              Your network already
              <br />
              knows the way in.
            </h1>
            <p className="mt-5 text-base leading-relaxed text-slate-400">
              Knownworld turns your Telegram history into a living map of the people you
              actually know — who they are now, where they work, how they can help — and
              answers real questions over it: warm paths to live job openings, who to meet
              in any city, partners worth a call. Your raw chats never leave your browser.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href={VIDEO_URL || '#'}
                target={VIDEO_URL ? '_blank' : undefined}
                rel="noopener noreferrer"
                aria-disabled={!VIDEO_URL}
                className={`inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                  VIDEO_URL
                    ? 'border-emerald-700 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/50'
                    : 'cursor-default border-slate-800 text-slate-500'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5v14l11-7z" />
                </svg>
                {VIDEO_URL ? 'Watch the 3-minute explainer' : 'Explainer video — coming'}
              </a>
              <span className="text-xs text-slate-500">
                open source · self-hosted in your own cloud
              </span>
            </div>
          </div>

          {/* sign-in card */}
          <div className="justify-self-center lg:justify-self-end">
            <Suspense>
              <AuthForm mode="login" embedded />
            </Suspense>
          </div>
        </div>

        {/* three steps */}
        <div className="mt-16 grid gap-4 sm:grid-cols-3">
          <Step
            n={1}
            title="Run the onboarding"
            text="Drop your Telegram export — it parses right in this tab. The agents distill a decade of chats into clean contact rows and research each person from public sources."
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
            title="Get your contact map"
            text="One database, three views: a world map of where everyone is, a network graph of who clusters where, and editable cards with work history, links and your own notes."
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
            title="Leverage it from every angle"
            text="Ask in plain language: live openings at your contacts' companies with a warm path in, who to meet at next week's conference, drafts for the intro — the network compounds."
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
              </svg>
            }
          />
        </div>

        <footer className="mt-14 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/70 pt-5 text-xs text-slate-500">
          <span>Raw chats stay in your browser. Distilled rows live in your own account.</span>
          <span>Gemini + ADK on Google Cloud</span>
        </footer>
      </div>
    </div>
  );
}
