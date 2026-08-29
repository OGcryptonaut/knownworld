'use client';

// Onboarding wizard — Upload → Distill → Research → Done. The step persists
// in localStorage so a reload resumes; a user whose database already exists
// gets a compact summary instead. "Start over" only resets the wizard step —
// the delete-everything switch stays on /privacy.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { DistilledPerson } from '@/lib/types';
import { Stepper } from '@/components/onboarding/Stepper';
import { UploadStep } from '@/components/onboarding/UploadStep';
import { DistillStep } from '@/components/onboarding/DistillStep';
import { ResearchStep } from '@/components/onboarding/ResearchStep';
import { DoneStep } from '@/components/onboarding/DoneStep';

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? '/agents';
const STEP_KEY = 'kw-wizard-step';

type Mode = 'checking' | 'wizard' | 'summary';

function readStoredStep(): number | null {
  try {
    const raw = window.localStorage.getItem(STEP_KEY);
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    return n >= 1 && n <= 4 ? n : null;
  } catch {
    return null;
  }
}

export default function OnboardingPage() {
  const [mode, setMode] = useState<Mode>('checking');
  const [step, setStepState] = useState(1);
  const [existing, setExisting] = useState<DistilledPerson[]>([]);

  const setStep = useCallback((n: number) => {
    setStepState(n);
    try {
      window.localStorage.setItem(STEP_KEY, String(n));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const stored = readStoredStep();
    void (async () => {
      let people: DistilledPerson[] = [];
      try {
        const res = await fetch(`${AGENTS_URL}/people`);
        if (res.ok) {
          const data = (await res.json()) as DistilledPerson[];
          if (Array.isArray(data)) people = data;
        }
      } catch {
        /* offline — fall through to the wizard */
      }
      setExisting(people);
      // Mid-wizard (steps 1–3) always resumes; otherwise an existing database
      // wins and the wizard is skipped.
      if (people.length > 0 && (stored === null || stored >= 4)) {
        setMode('summary');
      } else {
        setStepState(stored ?? 1);
        setMode('wizard');
      }
    })();
  }, []);

  if (mode === 'checking') {
    return (
      <div className="mx-auto max-w-3xl py-16 text-center text-sm text-slate-500">
        Checking your data…
      </div>
    );
  }

  if (mode === 'summary') {
    const workRelevant = existing.filter((p) => p.work_relevant).length;
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-400">
            Your known world is already built — pick up where you left off.
          </p>
        </div>

        <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <div>
              <div className="text-2xl font-semibold tabular-nums text-slate-100">
                {existing.length.toLocaleString()}
              </div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                Contacts distilled
              </div>
            </div>
            <div>
              <div className="text-2xl font-semibold tabular-nums text-slate-100">
                {workRelevant.toLocaleString()}
              </div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                Work-relevant
              </div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              href="/database"
              className="rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Open your database →
            </Link>
            <Link
              href="/requests"
              className="rounded-md border border-slate-700 px-5 py-2 text-sm text-slate-200 hover:border-emerald-700 hover:text-emerald-300"
            >
              Ask your network anything
            </Link>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <button
            type="button"
            onClick={() => {
              setStep(1);
              setMode('wizard');
            }}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-slate-400 hover:border-slate-500 hover:text-slate-200"
          >
            Start over
          </button>
          <span>
            restarts the wizard only — your data stays; wipe it on{' '}
            <Link href="/privacy" className="text-emerald-400 hover:underline">
              Privacy
            </Link>
            .
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Get started</h1>
        <p className="mt-1 text-sm text-slate-400">
          Turn your own Telegram history into a warm-network contact database. Four steps.
        </p>
      </div>

      <Stepper current={step} />

      {step === 1 && <UploadStep onContinue={() => setStep(2)} />}
      {step === 2 && <DistillStep onDone={() => setStep(3)} />}
      {step === 3 && <ResearchStep onDone={() => setStep(4)} onSkip={() => setStep(4)} />}
      {step === 4 && <DoneStep />}
    </div>
  );
}
