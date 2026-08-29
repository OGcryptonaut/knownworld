// Small badge vocabulary used across the app.
// 🔒 local     — data that never leaves the browser
// ☁ distilled  — only distilled rows ever persist server-side
// inferred     — model-inferred, never merged with definite facts

const base =
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 whitespace-nowrap';

export function LocalBadge() {
  return (
    <span className={`${base} border-emerald-800 bg-emerald-950/50 text-emerald-300`}>
      🔒 local
    </span>
  );
}

export function DistilledBadge() {
  return (
    <span className={`${base} border-sky-800 bg-sky-950/50 text-sky-300`}>
      ☁ distilled only
    </span>
  );
}

export function InferredBadge() {
  return (
    <span className={`${base} border-amber-700 bg-amber-950/50 text-amber-300`}>
      inferred
    </span>
  );
}

export function UnverifiedBadge() {
  return (
    <span className={`${base} border-amber-700 bg-amber-950/50 text-amber-300`}>
      unverified
    </span>
  );
}
