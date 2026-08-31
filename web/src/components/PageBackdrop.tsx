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

// a small deterministic constellation — nodes + the edges that link them
const STARS: [number, number][] = [
  [8, 16], [16, 9], [24, 20], [13, 30], [30, 12],
  [74, 68], [83, 60], [90, 74], [79, 84], [68, 78], [88, 88],
];
const EDGES: [number, number][] = [
  [0, 1], [1, 4], [1, 2], [0, 3], [2, 3],
  [5, 6], [6, 7], [7, 10], [7, 8], [8, 9], [9, 5],
];

/** Database — the known world: constellations in two corners and a slow
 *  dashed orbit, the map/graph idea carried into the room's air. */
function DatabaseBackdrop() {
  return (
    <>
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        {EDGES.map(([a, b], i) => (
          <line
            key={i}
            x1={STARS[a][0]}
            y1={STARS[a][1]}
            x2={STARS[b][0]}
            y2={STARS[b][1]}
            className="stroke-slate-700"
            strokeWidth={0.08}
            opacity={0.5}
          />
        ))}
        {STARS.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={i % 3 === 0 ? 0.5 : 0.32}
            className={i % 4 === 0 ? 'kw-twinkle fill-emerald-400' : 'fill-slate-600'}
            style={i % 4 === 0 ? { animationDelay: `${i * 0.9}s` } : undefined}
            opacity={i % 4 === 0 ? undefined : 0.55}
          />
        ))}
        <circle
          cx={104}
          cy={30}
          r={34}
          fill="none"
          className="stroke-slate-700"
          strokeWidth={0.1}
          strokeDasharray="0.7 1.6"
          opacity={0.5}
        />
      </svg>
      <div className="kw-drift absolute -right-[12vw] top-[8vh] h-[38vh] w-[38vw] rounded-full bg-emerald-600/8 blur-3xl" />
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
