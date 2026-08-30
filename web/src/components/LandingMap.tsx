'use client';

// Decorative world map for the landing — same world-atlas data as the real
// Database map, with a static constellation of hub-city dots and arcs
// suggesting a network. Purely visual; colors ride the theme palette.

import { useMemo } from 'react';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import worldData from 'world-atlas/countries-110m.json';

const W = 975;
const H = 500;

// a spread of hub cities (lat, lng) — the "known world" constellation
const HUBS: [number, number][] = [
  [37.77, -122.42], // SF
  [40.71, -74.01], // NYC
  [51.51, -0.13], // London
  [38.72, -9.14], // Lisbon
  [52.52, 13.4], // Berlin
  [50.45, 30.52], // Kyiv
  [25.2, 55.27], // Dubai
  [1.35, 103.82], // Singapore
  [35.68, 139.65], // Tokyo
  [-33.87, 151.21], // Sydney
  [59.33, 18.07], // Stockholm
  [19.43, -99.13], // CDMX
  [-23.55, -46.63], // São Paulo
  [30.27, -97.74], // Austin
  [41.01, 28.98], // Istanbul
];

export function LandingMap({ className = '' }: { className?: string }) {
  const { landPath, dots, arcs } = useMemo(() => {
    const projection = geoNaturalEarth1().fitExtent(
      [
        [0, 0],
        [W, H],
      ],
      { type: 'Sphere' },
    );
    const path = geoPath(projection);
    const topo = worldData as unknown as Topology;
    const countries = feature(topo, topo.objects.countries as GeometryCollection);
    const landPath = countries.features.map((f) => path(f) ?? '').join(' ');

    const dots = HUBS.map(([lat, lng]) => {
      const p = projection([lng, lat]);
      return p ? { x: p[0], y: p[1] } : null;
    }).filter((d): d is { x: number; y: number } => d !== null);

    // a few gentle arcs between hubs (quadratic curves lifted toward the pole)
    const pairs: [number, number][] = [
      [0, 3],
      [3, 5],
      [2, 6],
      [0, 8],
      [10, 6],
      [1, 12],
    ];
    const arcs = pairs
      .map(([a, b]) => {
        const s = dots[a];
        const t = dots[b];
        if (!s || !t) return null;
        const mx = (s.x + t.x) / 2;
        const my = Math.min(s.y, t.y) - Math.abs(s.x - t.x) * 0.18 - 18;
        return `M ${s.x} ${s.y} Q ${mx} ${my} ${t.x} ${t.y}`;
      })
      .filter((d): d is string => d !== null);

    return { landPath, dots, arcs };
  }, []);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label="World map with a network of contacts"
    >
      <path d={landPath} className="fill-slate-800/80 stroke-slate-700/60" strokeWidth={0.5} />
      {arcs.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          className="stroke-emerald-500/40"
          strokeWidth={1.2}
          strokeDasharray="1 6"
          strokeLinecap="round"
        />
      ))}
      {dots.map((d, i) => (
        <g key={i}>
          <circle cx={d.x} cy={d.y} r={9} className="fill-emerald-500/15">
            <animate
              attributeName="r"
              values="7;11;7"
              dur={`${3 + (i % 4)}s`}
              repeatCount="indefinite"
            />
          </circle>
          <circle cx={d.x} cy={d.y} r={3.2} className="fill-emerald-500" />
        </g>
      ))}
    </svg>
  );
}
