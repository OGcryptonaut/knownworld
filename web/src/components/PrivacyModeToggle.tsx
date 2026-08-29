'use client';

import { usePrivacy } from '@/components/PrivacyProvider';

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {off ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

export function PrivacyModeToggle() {
  const { masked, setMasked } = usePrivacy();

  return (
    <button
      type="button"
      onClick={() => setMasked(!masked)}
      aria-pressed={masked}
      title={masked ? 'Names are masked on screen' : 'Names are shown in full'}
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
        masked
          ? 'border-emerald-800 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-950'
          : 'border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800'
      }`}
    >
      <EyeIcon off={masked} />
      <span>Privacy display mode</span>
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
          masked ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-300'
        }`}
      >
        {masked ? 'on' : 'off'}
      </span>
    </button>
  );
}
