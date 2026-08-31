'use client';

// Ambient, theme-aware page backdrops — one quiet visual idea per page,
// fixed behind the content (cards are translucent, so it glows through).
// Everything rides the palette tokens (slate/emerald utilities), so dark
// renders blue-on-ink and light renders orange-on-paper with zero changes.
// Pure CSS/SVG, positioned in viewport percentages: responsive by
// construction. Motion is slow and honors prefers-reduced-motion (see the
// kw-* classes in globals.css).

const DOT_GRID: React.CSSProperties = {
  backgroundImage: 'radial-gradient(var(--color-slate-700) 1px, transparent 1.5px)',
  backgroundSize: '26px 26px',
};

/** Onboarding — distillation: raw streams fall through a faint grid and a
 *  warm glow settles at the bottom, where the database forms. */
function WizardBackdrop() {
  return (
    <>
      <div
        className="absolute inset-x-0 top-0 h-[55vh] opacity-25"
        style={{
          ...DOT_GRID,
          maskImage: 'radial-gradient(80% 100% at 50% 0%, black 20%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(80% 100% at 50% 0%, black 20%, transparent 100%)',
        }}
      />
      {[
        { left: '12%', delay: '0s', dur: '13s' },
        { left: '34%', delay: '4s', dur: '10s' },
        { left: '58%', delay: '1.5s', dur: '12s' },
        { left: '81%', delay: '6s', dur: '11s' },
      ].map((s) => (
        <span
          key={s.left}
          className="kw-fall absolute top-0 h-[34vh] w-px bg-gradient-to-b from-transparent via-emerald-500/35 to-transparent"
          style={{ left: s.left, animationDelay: s.delay, animationDuration: s.dur }}
        />
      ))}
      <div
        className="kw-drift absolute -bottom-[18vh] left-1/2 h-[46vh] w-[70vw] -translate-x-1/2 rounded-full bg-emerald-600/10 blur-3xl"
      />
    </>
  );
}

/** Database — the known world: quiet orbit rings around the top-left corner
 *  (the requests radar's calm sibling), a faint dot grid where the panels
 *  sit, and a slow glow drifting along the bottom. Same family as every
 *  other page: rings + grid + one emerald glow, nothing busier. */
function DatabaseBackdrop() {
  return (
    <>
      <div
        className="absolute inset-x-0 top-0 h-[60vh] opacity-20"
        style={{
          ...DOT_GRID,
          maskImage: 'radial-gradient(90% 100% at 50% 0%, black 15%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(90% 100% at 50% 0%, black 15%, transparent 100%)',
        }}
      />
      {[24, 40, 56, 72].map((size, i) => (
        <div
          key={size}
          className={`absolute rounded-full border ${
            i === 1 ? 'border-emerald-600/25' : 'border-slate-700/40'
          }`}
          style={{
            width: `${size}vmax`,
            height: `${size}vmax`,
            top: `calc(-${size / 2}vmax + 6vh)`,
            left: `calc(-${size / 2}vmax + 8vw)`,
          }}
        />
      ))}
      {[
        { left: '30%', top: '18%', delay: '0s' },
        { left: '12%', top: '44%', delay: '2.2s' },
        { left: '48%', top: '8%', delay: '4.1s' },
      ].map((d) => (
        <span
          key={d.left}
          className="kw-twinkle absolute h-1.5 w-1.5 rounded-full bg-emerald-400"
          style={{ left: d.left, top: d.top, animationDelay: d.delay }}
        />
      ))}
      <div className="kw-drift absolute -bottom-[16vh] right-[4vw] h-[40vh] w-[46vw] rounded-full bg-emerald-600/10 blur-3xl" />
    </>
  );
}

/** Requests — asking the network: a radar corner pinging outward, faint
 *  answers twinkling back. */
function RequestsBackdrop() {
  return (
    <>
      {[22, 38, 54, 70].map((size) => (
        <div
          key={size}
          className="absolute rounded-full border border-slate-700/40"
          style={{
            width: `${size}vmax`,
            height: `${size}vmax`,
            top: `calc(-${size / 2}vmax + 8vh)`,
            right: `calc(-${size / 2}vmax + 12vw)`,
          }}
        />
      ))}
      <div
        className="kw-ping absolute rounded-full border-2 border-emerald-500/40"
        style={{
          width: '46vmax',
          height: '46vmax',
          top: 'calc(-23vmax + 8vh)',
          right: 'calc(-23vmax + 12vw)',
        }}
      />
      {[
        { left: '14%', top: '62%', delay: '0s' },
        { left: '28%', top: '38%', delay: '1.6s' },
        { left: '48%', top: '76%', delay: '3.1s' },
        { left: '70%', top: '58%', delay: '4.4s' },
      ].map((d) => (
        <span
          key={d.left}
          className="kw-twinkle absolute h-1.5 w-1.5 rounded-full bg-emerald-400"
          style={{ left: d.left, top: d.top, animationDelay: d.delay }}
        />
      ))}
      <div className="absolute -left-[10vw] bottom-[0vh] h-[30vh] w-[40vw] rounded-full bg-emerald-600/8 blur-3xl" />
    </>
  );
}

/** Privacy — the boundary: calm shield rings around one corner and a fine
 *  ruled grid that fades out fast. Still on purpose: nothing moves here. */
function PrivacyBackdrop() {
  return (
    <>
      <div
        className="absolute inset-0 opacity-15"
        style={{
          backgroundImage:
            'linear-gradient(var(--color-slate-700) 1px, transparent 1px), linear-gradient(90deg, var(--color-slate-700) 1px, transparent 1px)',
          backgroundSize: '72px 72px',
          maskImage: 'radial-gradient(70% 70% at 0% 100%, black 0%, transparent 85%)',
          WebkitMaskImage: 'radial-gradient(70% 70% at 0% 100%, black 0%, transparent 85%)',
        }}
      />
      {[26, 40, 54].map((size, i) => (
        <div
          key={size}
          className={`absolute rounded-full border ${
            i === 0 ? 'border-emerald-600/30' : 'border-slate-700/40'
          }`}
          style={{
            width: `${size}vmax`,
            height: `${size}vmax`,
            bottom: `calc(-${size / 2}vmax + 6vh)`,
            left: `calc(-${size / 2}vmax + 6vw)`,
          }}
        />
      ))}
      <div className="absolute right-[4vw] top-[10vh] h-[26vh] w-[26vw] rounded-full bg-emerald-600/8 blur-3xl" />
    </>
  );
}

export type BackdropVariant = 'wizard' | 'database' | 'requests' | 'privacy';

const VARIANTS: Record<BackdropVariant, () => React.JSX.Element> = {
  wizard: WizardBackdrop,
  database: DatabaseBackdrop,
  requests: RequestsBackdrop,
  privacy: PrivacyBackdrop,
};

export function PageBackdrop({ variant }: { variant: BackdropVariant }) {
  const Variant = VARIANTS[variant];
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <Variant />
    </div>
  );
}
