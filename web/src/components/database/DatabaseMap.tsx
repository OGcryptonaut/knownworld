'use client';

// Map panel — dots only where the enrichment card carries evidence
// coordinates. Honest by construction: no geocoding guesses client-side, so
// unverified rows simply have no dot. Clicking a dot selects that person's
// table row below.

import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import worldData from 'world-atlas/countries-110m.json';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';
import { companyOf, type DbRow } from './shared';

const W = 975;
const H = 500;

const projection = geoNaturalEarth1().fitExtent(
  [
    [8, 8],
    [W - 8, H - 8],
  ],
  { type: 'Sphere' },
);
const path = geoPath(projection);

const topo = worldData as unknown as Topology;
const countries = feature(
  topo,
  topo.objects.countries as GeometryCollection,
).features.map((f) => path(f) ?? '');

interface Dot {
  key: string;
  x: number;
  y: number;
  r: number;
  count: number;
  rows: DbRow[];
}

const CLUSTER_MIN = 6; // >5 dots on the same rounded city coords collapse

function dotRadius(closeness: number): number {
  return 3 + (Math.max(0, Math.min(100, closeness)) / 100) * 4;
}

function buildDots(rows: DbRow[]): Dot[] {
  const groups = new Map<string, DbRow[]>();
  for (const row of rows) {
    const lat = row.card?.location_lat;
    const lng = row.card?.location_lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const key = `${lat.toFixed(1)},${lng.toFixed(1)}`;
    const g = groups.get(key);
    if (g) g.push(row);
    else groups.set(key, [row]);
  }

  const dots: Dot[] = [];
  for (const [key, group] of groups) {
    if (group.length >= CLUSTER_MIN) {
      const first = group[0];
      const p = projection([first.card!.location_lng!, first.card!.location_lat!]);
      if (!p) continue;
      dots.push({ key, x: p[0], y: p[1], r: 8, count: group.length, rows: group });
    } else {
      group.forEach((row, i) => {
        const p = projection([row.card!.location_lng!, row.card!.location_lat!]);
        if (!p) return;
        // deterministic ring offset so identical rounded coords stay hoverable
        const angle = (2 * Math.PI * i) / group.length;
        const jitter = group.length > 1 ? 5 : 0;
        dots.push({
          key: `${key}:${row.person.tg_id}`,
          x: p[0] + jitter * Math.cos(angle),
          y: p[1] + jitter * Math.sin(angle),
          r: dotRadius(row.person.closeness),
          count: 1,
          rows: [row],
        });
      });
    }
  }
  return dots;
}

interface Tooltip {
  x: number;
  y: number;
  lines: string[];
}

export function DatabaseMap({
  rows,
  onSelect,
}: {
  rows: DbRow[];
  onSelect: (tgId: number) => void;
}) {
  const { masked } = usePrivacy();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const dots = useMemo(() => buildDots(rows), [rows]);

  const showTooltip = (e: ReactMouseEvent, dot: Dot) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const lines: string[] = [];
    if (dot.count === 1) {
      const { person, card } = dot.rows[0];
      lines.push(person.name.trim() === '' ? '(unnamed)' : displayName(person.name, masked));
      const company = companyOf(dot.rows[0]).name;
      if (company) lines.push(company);
      if (card?.location) lines.push(card.location);
    } else {
      lines.push(`${dot.count} contacts — ${dot.rows[0].card?.location ?? 'same city'}`);
      for (const r of dot.rows.slice(0, 4)) {
        lines.push(r.person.name.trim() === '' ? '(unnamed)' : displayName(r.person.name, masked));
      }
      if (dot.rows.length > 4) lines.push(`+${dot.rows.length - 4} more`);
    }
    setHoverKey(dot.key);
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, lines });
  };

  const located = dots.reduce((n, d) => n + d.count, 0);

  return (
    <div className="flex h-[360px] flex-col rounded-lg border border-slate-800 bg-slate-900/40">
      <div className="flex items-center gap-3 border-b border-slate-800/80 px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Map</span>
        <span className="ml-auto text-[11px] tabular-nums text-slate-500">
          {located} of {rows.length} located
        </span>
      </div>

      <div ref={containerRef} className="relative min-h-0 flex-1 p-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
          role="img"
          aria-label="Contact map"
        >
          {countries.map((d, i) => (
            <path key={i} d={d} className="fill-slate-800 stroke-slate-700" strokeWidth={0.5} />
          ))}
          {dots.map((dot) => (
            <g
              key={dot.key}
              onMouseEnter={(e) => showTooltip(e, dot)}
              onMouseMove={(e) => showTooltip(e, dot)}
              onMouseLeave={() => {
                setTooltip(null);
                setHoverKey(null);
              }}
              onClick={() => {
                if (dot.count === 1) onSelect(dot.rows[0].person.tg_id);
              }}
              className={dot.count === 1 ? 'cursor-pointer' : 'cursor-default'}
            >
              <circle
                cx={dot.x}
                cy={dot.y}
                r={dot.r}
                className={`fill-emerald-400/80 ${
                  hoverKey === dot.key ? 'stroke-emerald-200' : 'stroke-transparent'
                }`}
                strokeWidth={1.5}
              />
              {dot.count > 1 && (
                <text
                  x={dot.x}
                  y={dot.y + 2.5}
                  textAnchor="middle"
                  className="fill-slate-950 text-[8px] font-semibold"
                >
                  {dot.count}
                </text>
              )}
            </g>
          ))}
        </svg>
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 max-w-[220px] rounded-md border border-slate-700 bg-slate-950/95 px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
          >
            {tooltip.lines.map((line, i) => (
              <p key={i} className={i === 0 ? 'font-medium text-slate-100' : 'text-slate-400'}>
                {line}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-800/80 px-3 py-1.5 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
          <span className="h-3 w-3 rounded-full bg-emerald-400/80" />
          size = closeness
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-400/80 text-[8px] font-semibold text-slate-950">
            n
          </span>
          {CLUSTER_MIN}+ in one city
        </span>
        <span className="ml-auto truncate">dots only where evidence has coordinates</span>
      </div>
    </div>
  );
}
