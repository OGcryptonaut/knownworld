'use client';

// Map panel — dots only where the enrichment card carries evidence
// coordinates. Honest by construction: no geocoding guesses client-side, so
// unverified rows simply have no dot.
//
// Atlas-crm doctrine: the map is a CITY view, not a people view. Two or
// more people in one city render as one count circle by the city; clicking
// it filters every view to that city (the same unified selection the graph
// hubs use). Zooming out merges nearby cities into a bigger count circle
// (click = filter to exactly those people); zooming in splits them apart
// and reveals city names. A lone person stays an individual dot that
// selects their table row. Scroll zooms, drag pans.

import {
  useMemo,
  useRef,
  useState,
  useEffect,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
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

const CLUSTER_CELL = 40; // screen px — city circles closer than this merge
const LABEL_K = 2.2; // city names appear from this zoom level
const SPREAD_K = 4; // zoomed past this, merged areas fan out into their cities
const GOLDEN_ANGLE = 2.39996; // radians — deterministic fan, no collisions
const MIN_K = 1;
const MAX_K = 14;

interface PersonDot {
  key: string;
  x: number;
  y: number;
  r: number;
  row: DbRow;
}

/** One city (or merged area) as a count circle. */
interface CityMarker {
  key: string;
  x: number;
  y: number;
  count: number;
  /** set → click filters by city; null (merged area / unknown city) → by ids */
  city: string | null;
  label: string;
  ids: number[];
}

function dotRadius(closeness: number): number {
  return 3 + (Math.max(0, Math.min(100, closeness)) / 100) * 4;
}

/** count circle radius, atlas-style: grows sublinearly with the count */
function badgeRadius(count: number): number {
  return Math.min(18, 7 + Math.sqrt(count) * 1.6);
}

function sortedIds(rows: DbRow[]): number[] {
  return rows.map((r) => r.person.tg_id).sort((a, b) => a - b);
}

function dominantCity(rows: DbRow[]): string | null {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const c = cityOf(row);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [c, k] of counts) {
    if (k > n) {
      n = k;
      best = c;
    }
  }
  return best;
}

function buildMarkers(
  rows: DbRow[],
  k: number,
): { dots: PersonDot[]; cities: CityMarker[]; located: number } {
  // stage 1: group by city (exact coords for rows with no city name)
  const byCity = new Map<string, { rows: DbRow[]; x: number; y: number; city: string | null }>();
  let located = 0;
  for (const row of rows) {
    const lat = row.card?.location_lat;
    const lng = row.card?.location_lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const p = projection([lng, lat]);
    if (!p) continue;
    located += 1;
    const city = cityOf(row);
    const key = city ?? `${lat.toFixed(2)},${lng.toFixed(2)}`;
    const g = byCity.get(key);
    if (g) {
      g.rows.push(row);
    } else {
      byCity.set(key, { rows: [row], x: p[0], y: p[1], city });
    }
  }

  // stage 2: merge cities that overlap at this zoom (screen-space grid)
  const cell = CLUSTER_CELL / k;
  const byCell = new Map<string, { rows: DbRow[]; x: number; y: number; cities: string[] }[]>();
  for (const g of byCity.values()) {
    const key = `${Math.floor(g.x / cell)},${Math.floor(g.y / cell)}`;
    const list = byCell.get(key);
    const entry = { rows: g.rows, x: g.x, y: g.y, cities: g.city ? [g.city] : [] };
    if (list) list.push(entry);
    else byCell.set(key, [entry]);
  }

  const dots: PersonDot[] = [];
  const cities: CityMarker[] = [];

  const pushDot = (row: DbRow, x: number, y: number): void => {
    dots.push({
      key: `p:${row.person.tg_id}`,
      x,
      y,
      r: dotRadius(row.person.closeness),
      row,
    });
  };
  const pushCity = (
    key: string,
    x: number,
    y: number,
    rows2: DbRow[],
    city: string | null,
  ): void => {
    const dom = city ?? dominantCity(rows2);
    cities.push({
      key,
      x,
      y,
      count: rows2.length,
      city,
      label: city ?? (dom ? `${rows2.length} around ${dom}` : `${rows2.length} contacts`),
      ids: sortedIds(rows2),
    });
  };

  for (const [cellKey, groups] of byCell) {
    const all = groups.flatMap((g) => g.rows);
    const cx = groups.reduce((s, g) => s + g.x * g.rows.length, 0) / all.length;
    const cy = groups.reduce((s, g) => s + g.y * g.rows.length, 0) / all.length;

    if (all.length === 1) {
      pushDot(all[0], cx, cy);
      continue;
    }

    if (groups.length === 1) {
      // one city alone in the cell → a real city marker (click filters by city)
      pushCity(`c:${cellKey}`, cx, cy, groups[0].rows, groups[0].cities[0] ?? null);
      continue;
    }

    if (k < SPREAD_K) {
      // several cities overlap at this zoom → one merged area circle
      pushCity(`c:${cellKey}`, cx, cy, all, null);
      continue;
    }

    // zoomed in: cities that STILL overlap geographically (Bay Area style)
    // fan out at constant screen spacing so each city stays clickable
    groups.forEach((g, i) => {
      const rPx = i === 0 ? 0 : (26 + 14 * Math.floor((i - 1) / 6)) / k;
      const ang = i * GOLDEN_ANGLE;
      const gx = cx + rPx * Math.cos(ang);
      const gy = cy + rPx * Math.sin(ang);
      if (g.rows.length === 1) pushDot(g.rows[0], gx, gy);
      else pushCity(`c:${cellKey}:${i}`, gx, gy, g.rows, g.cities[0] ?? null);
    });
  }
  return { dots, cities, located };
}

interface Tooltip {
  x: number;
  y: number;
  lines: string[];
}

export function DatabaseMap({
  rows,
  onSelect,
  onCityToggle,
  onClusterToggle,
}: {
  rows: DbRow[];
  onSelect: (tgId: number) => void;
  /** click on a single-city circle — the same unified city filter as the graph */
  onCityToggle: (city: string) => void;
  /** click on a merged area or a no-name spot — filter by exactly these ids */
  onClusterToggle: (ids: number[], label: string) => void;
}) {
  const { masked } = usePrivacy();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [transform, setTransform] = useState({ k: 1, tx: 0, ty: 0 });
  // pan bookkeeping — a real drag must not fire the click underneath
  const panRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const { k } = transform;
  const { dots, cities, located } = useMemo(() => buildMarkers(rows, k), [rows, k]);

  // wheel zoom around the pointer; non-passive so the page does not scroll
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const py = ((e.clientY - rect.top) / rect.height) * H;
      setTransform((t) => {
        const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
        const nk = Math.max(MIN_K, Math.min(MAX_K, t.k * factor));
        const applied = nk / t.k;
        return { k: nk, tx: px - applied * (px - t.tx), ty: py - applied * (py - t.ty) };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    panRef.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    const svg = svgRef.current;
    if (!pan || !svg) return;
    const dx = e.clientX - pan.x;
    const dy = e.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < 3) return;
    pan.moved = true;
    const rect = svg.getBoundingClientRect();
    panRef.current = { x: e.clientX, y: e.clientY, moved: true };
    setTransform((t) => ({
      ...t,
      tx: t.tx + dx * (W / rect.width),
      ty: t.ty + dy * (H / rect.height),
    }));
  };
  const endPan = () => {
    // cleared on the next tick so click handlers can still see `moved`
    setTimeout(() => {
      panRef.current = null;
    }, 0);
  };
  const wasDrag = () => panRef.current?.moved === true;

  const resetView = () => setTransform({ k: 1, tx: 0, ty: 0 });
  const viewMoved = transform.k !== 1 || transform.tx !== 0 || transform.ty !== 0;

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

  const cityHandlers = (c: CityMarker) => ({
    onMouseEnter: (e: ReactMouseEvent) =>
      showTooltip(e, c.key, [c.label, `${c.count} people · click to filter`]),
    onMouseMove: (e: ReactMouseEvent) =>
      showTooltip(e, c.key, [c.label, `${c.count} people · click to filter`]),
    onMouseLeave: hideTooltip,
    onClick: () => {
      if (wasDrag()) return;
      if (c.city) onCityToggle(c.city);
      else onClusterToggle(c.ids, c.label);
    },
  });

  return (
    <div className="flex h-[260px] flex-col rounded-lg border border-slate-800 bg-slate-900/40 sm:h-[320px] xl:h-[360px]">
      <div className="flex items-center gap-3 border-b border-slate-800/80 px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Map</span>
        {viewMoved && (
          <button
            type="button"
            onClick={resetView}
            className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400 hover:border-slate-500 hover:text-slate-200"
          >
            reset view
          </button>
        )}
        <span className="ml-auto text-[11px] text-slate-500">scroll to zoom · drag to pan</span>
        <span className="text-[11px] tabular-nums text-slate-500">
          {located} of {rows.length} located
        </span>
      </div>

      <div ref={containerRef} className="relative min-h-0 flex-1 p-1">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full cursor-grab active:cursor-grabbing"
          role="img"
          aria-label="Contact map"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
        >
          <g transform={`translate(${transform.tx},${transform.ty}) scale(${k})`}>
            {countries.map((d, i) => (
              <path
                key={i}
                d={d}
                className="fill-slate-800 stroke-slate-700"
                strokeWidth={0.5 / k}
              />
            ))}
            {dots.map((dot) => (
              <g
                key={dot.key}
                onMouseEnter={(e) => showTooltip(e, dot.key, dotLines(dot))}
                onMouseMove={(e) => showTooltip(e, dot.key, dotLines(dot))}
                onMouseLeave={hideTooltip}
                onClick={() => {
                  if (!wasDrag()) onSelect(dot.row.person.tg_id);
                }}
                className="cursor-pointer"
              >
                <circle
                  cx={dot.x}
                  cy={dot.y}
                  r={dot.r / k}
                  className={`fill-emerald-400/80 ${
                    hoverKey === dot.key ? 'stroke-emerald-200' : 'stroke-transparent'
                  }`}
                  strokeWidth={1.5 / k}
                />
              </g>
            ))}
            {cities.map((c) => {
              const r = badgeRadius(c.count) / k;
              return (
                <g key={c.key} className="cursor-pointer" {...cityHandlers(c)}>
                  {/* soft glow under the count circle, atlas-style */}
                  <circle cx={c.x} cy={c.y} r={r * 1.8} className="fill-emerald-500/10" />
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={r}
                    className={`fill-emerald-950/90 ${
                      hoverKey === c.key ? 'stroke-emerald-300' : 'stroke-emerald-500/80'
                    }`}
                    strokeWidth={1.25 / k}
                  />
                  <text
                    x={c.x}
                    y={c.y}
                    dy="0.35em"
                    textAnchor="middle"
                    fontSize={(c.count >= 10 ? 9 : 10) / k}
                    className="pointer-events-none fill-emerald-300 font-semibold"
                  >
                    {c.count}
                  </text>
                  {k >= LABEL_K && c.city && (
                    <text
                      x={c.x}
                      y={c.y + r + 9 / k}
                      textAnchor="middle"
                      fontSize={9 / k}
                      className="pointer-events-none fill-slate-400"
                    >
                      {c.city}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
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
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-emerald-600/80 bg-slate-950 text-[8px] font-semibold text-emerald-300">
            n
          </span>
          people in a city. Click to filter, zoom in for city names
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
          one person. Click to open their row
        </span>
        <span className="ml-auto truncate">dots only where evidence has coordinates</span>
      </div>
    </div>
  );
}
