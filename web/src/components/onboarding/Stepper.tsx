// Wizard progress header — presentational only; step state lives in the page
// and is persisted there so a reload resumes.

const STEPS = ['Upload', 'Distill', 'Research', 'Done'] as const;

export function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const complete = n < current;
        const active = n === current;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
            <span className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  complete
                    ? 'bg-emerald-600 text-white'
                    : active
                      ? 'border border-emerald-500 bg-emerald-500/15 text-emerald-300'
                      : 'border border-slate-700 text-slate-500'
                }`}
              >
                {complete ? '✓' : n}
              </span>
              <span
                className={`hidden text-xs sm:inline ${
                  complete ? 'text-emerald-300' : active ? 'font-medium text-slate-100' : 'text-slate-500'
                }`}
              >
                {label}
              </span>
            </span>
            {n < STEPS.length && (
              <span className={`h-px min-w-4 flex-1 ${complete ? 'bg-emerald-700' : 'bg-slate-800'}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
