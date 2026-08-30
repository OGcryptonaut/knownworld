'use client';

// Map panel — dots only where the enrichment card carries evidence
// coordinates. Honest by construction: no geocoding guesses client-side, so
// unverified rows simply have no dot. Golden-angle scatter (adopted from the
// owner's atlas-crm reference) spreads same-city rows so EVERY person stays
// an individually hoverable, clickable dot; groups of 3+ also get a halo +
// count chip that toggles a cluster selection filtering all three views.
// Clicking a dot selects that person's table row below.

import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import worldData from 'world-atlas/countries-110m.json';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';
import { cityOf, companyOf, type DbRow } from './shared';

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

const GOLDEN_ANGLE = 2.39996; // radians — phyllotaxis spread, no collisions
const CLUSTER_MIN = 3; // 3+ in one city get the halo + count-chip affordance

interface PersonDot {
  key: string;
  x: number;
  y: number;
  r: number;
  row: DbRow;
}

interface Cluster {
  key: string;
  cx: number;
  cy: number;
  haloR: number;
  count: number;
  ids: number[]; // sorted — page compares them for the click-again toggle
  label: string; // "N in <dominant city>"
}

function dotRadius(closeness: number): number {
  return 3 + (Math.max(0, Math.min(100, closeness)) / 100) * 4;
}

function buildMarkers(rows: DbRow[]): { dots: PersonDot[]; clusters: Cluster[] } {
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

  const dots: PersonDot[] = [];
  const clusters: Cluster[] = [];
  for (const [key, group] of groups) {
    const members: PersonDot[] = [];
    group.forEach((row, i) => {
      // deterministic golden-angle ring in DEGREE space around the true
      // coord: member 0 dead center, 8 per ring after that
      const rDeg = i === 0 ? 0 : 0.045 + 0.014 * Math.floor(i / 8);
      const ang = i * GOLDEN_ANGLE;
      const p = projection([
        row.card!.location_lng! + rDeg * Math.cos(ang),
        row.card!.location_lat! + rDeg * Math.sin(ang),
      ]);
      if (!p) return;
      members.push({
        key: `${key}:${row.person.tg_id}`,
        x: p[0],
        y: p[1],
        r: dotRadius(row.person.closeness),
        row,
      });
    });
    dots.push(...members);

    if (members.length >= CLUSTER_MIN) {
      const cx = members.reduce((s, d) => s + d.x, 0) / members.length;
      const cy = members.reduce((s, d) => s + d.y, 0) / members.length;
      const spread = Math.max(...members.map((d) => Math.hypot(d.x - cx, d.y - cy) + d.r));
      // dominant city among members labels the cluster selection
      const cityCounts = new Map<string, number>();
      for (const d of members) {
        const c = cityOf(d.row);
        if (c) cityCounts.set(c, (cityCounts.get(c) ?? 0) + 1);
      }
      let city: string | null = null;
      let best = 0;
      for (const [c, n] of cityCounts) {
        if (n > best) {
          best = n;
          city = c;
        }
      }
      clusters.push({
        key,
        cx,
        cy,
        haloR: Math.max(10, spread + 4),
        count: members.length,
        ids: members.map((d) => d.row.person.tg_id).sort((a, b) => a - b),
        label: city ? `${members.length} in ${city}` : `${members.length} contacts`,
      });
    }
  }
  return { dots, clusters };
}

interface Tooltip {
  x: number;
  y: number;
  lines: string[];
}

export function DatabaseMap({
  rows,
  onSelect,
  onClusterToggle,
}: {
  rows: DbRow[];
  onSelect: (tgId: number) => void;
  onClusterToggle: (ids: number[], label: string) => void;
}) {
  const { masked } = usePrivacy();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const { dots, clusters } = useMemo(() => buildMarkers(rows), [rows]);

  const showTooltip = (e: ReactMouseEvent, key: string, lines: string[]) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoverKey(key);
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, lines });
  };
  const hideTooltip = () => {
    setTooltip(null);
    setHoverKey(null);
  };

  const dotLines = (dot: PersonDot): string[] => {
    const { person, card } = dot.row;
    const lines = [person.name.trim() === '' ? '(unnamed)' : displayName(person.name, masked)];
    const company = companyOf(dot.row).name;
    if (company) lines.push(company);
    if (card?.location) lines.push(card.location);
    return lines;
  };

  const clusterHandlers = (c: Cluster) => ({
    onMouseEnter: (e: ReactMouseEvent) =>
      showTooltip(e, `c:${c.key}`, [c.label, `click to filter these ${c.count}`]),
    onMouseMove: (e: ReactMouseEvent) =>
      showTooltip(e, `c:${c.key}`, [c.label, `click to filter these ${c.count}`]),
    onMouseLeave: hideTooltip,
    onClick: () => onClusterToggle(c.ids, c.label),
  });

  const located = dots.length;

  return (
    <div className="flex h-[260px] flex-col rounded-lg border border-slate-800 bg-slate-900/40 sm:h-[320px] xl:h-[360px]">
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
          {/* halos under the dots so individual dots keep winning hover/click */}
          {clusters.map((c) => (
            <circle
              key={`halo:${c.key}`}
              cx={c.cx}
              cy={c.cy}
              r={c.haloR}
              className="cursor-pointer fill-emerald-400/10 stroke-emerald-500/25"
              strokeWidth={0.75}
              {...clusterHandlers(c)}
            />
          ))}
          {dots.map((dot) => (
            <g
              key={dot.key}
              onMouseEnter={(e) => showTooltip(e, dot.key, dotLines(dot))}
              onMouseMove={(e) => showTooltip(e, dot.key, dotLines(dot))}
              onMouseLeave={hideTooltip}
              onClick={() => onSelect(dot.row.person.tg_id)}
              className="cursor-pointer"
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
            </g>
          ))}
          {clusters.map((c) => (
            <g key={`chip:${c.key}`} className="cursor-pointer" {...clusterHandlers(c)}>
              <circle
                cx={c.cx}
                cy={c.cy - c.haloR - 8}
                r={7.5}
                className={`fill-slate-950 ${
                  hoverKey === `c:${c.key}` ? 'stroke-emerald-300' : 'stroke-emerald-600/80'
                }`}
                strokeWidth={1}
              />
              <text
                x={c.cx}
                y={c.cy - c.haloR - 5.5}
                textAnchor="middle"
                className="fill-emerald-300 text-[8px] font-semibold"
              >
                {c.count}
              </text>
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
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-emerald-600/80 bg-slate-950 text-[8px] font-semibold text-emerald-300">
            n
          </span>
          {CLUSTER_MIN}+ in one city — click to filter
        </span>
        <span className="ml-auto truncate">dots only where evidence has coordinates</span>
      </div>
    </div>
  );
}
