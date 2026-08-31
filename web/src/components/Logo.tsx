// The Knownworld mark: an open world-ring with a small constellation
// inside — your people, mapped, with one node standing on the world's
// edge. Rides the palette tokens (emerald = blue in dark, orange in
// light; slate follows the theme), so one component fits everywhere.

export function Logo({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      {/* the world: an open ring — the gap is where your network reaches out */}
      <circle
        cx="16"
        cy="16"
        r="12.5"
        fill="none"
        className="stroke-emerald-500"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray="61 18"
        transform="rotate(-56 16 16)"
      />
      {/* constellation edges */}
      <path
        d="M13.4 18.6 L24.4 7.9 M13.4 18.6 L21.2 21.8"
        className="stroke-slate-400"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* you */}
      <circle cx="13.4" cy="18.6" r="3.1" className="fill-emerald-500" />
      {/* the node standing in the ring's gap */}
      <circle cx="24.4" cy="7.9" r="2.4" className="fill-emerald-400" />
      {/* a quieter contact */}
      <circle cx="21.2" cy="21.8" r="1.9" className="fill-slate-400" />
    </svg>
  );
}
