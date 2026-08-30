'use client';

// Map panel — dots only where the enrichment card carries evidence
// coordinates. Honest by construction: no geocoding guesses client-side, so
// unverified rows simply have no dot.
//
// Zoomable: scroll to zoom, drag to pan. Nearby people collapse into a
// count badge while zoomed out; zooming in splits areas apart, and past
// SPLIT_K same-spot groups fan out into individually clickable dots
// (golden-angle spread, adopted from the owner's atlas-crm reference).
// Clicking a badge toggles a cluster selection that filters all three views;
// clicking a dot selects that person's table row below.

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

const GOLDEN_ANGLE = 2.39996; // radians — phyllotaxis spread, no collisions
const CLUSTER_MIN = 3; // 3+ spread dots also get the halo + count-chip filter
const CLUSTER_CELL = 34; // screen px — closer than this merges into one badge
const SPLIT_K = 6; // zoomed past this, same-spot groups fan out into dots
const MIN_K = 1;
const MAX_K = 14;

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

interface Badge {
  key: string;
  cx: number;
  cy: number;
  count: number;
  ids: number[];
  label: string;
}

function dotRadius(closeness: number): number {
  return 3 + (Math.max(0, Math.min(100, closeness)) / 100) * 4;
}

function dominantLabel(rows: DbRow[]): string {
  const cityCounts = new Map<string, number>();
  for (const row of rows) {
    const c = cityOf(row);
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
  return city ? `${rows.length} in ${city}` : `${rows.length} contacts`;
}

function sortedIds(rows: DbRow[]): number[] {
  return rows.map((r) => r.person.tg_id).sort((a, b) => a - b);
}

/**
 * Cluster in screen space: grid cells shrink as you zoom in, so areas split
 * apart naturally. Same-spot groups become a badge below SPLIT_K and a
 * golden-angle fan of individually clickable dots above it.
 */
function buildMarkers(
  rows: DbRow[],
  k: number,
): { dots: PersonDot[]; clusters: Cluster[]; badges: Badge[]; located: number } {
  const located: { row: DbRow; x: number; y: number }[] = [];
  for (const row of rows) {
    const lat = row.card?.location_lat;
    const lng = row.card?.location_lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const p = projection([lng, lat]);
    if (!p) continue;
    located.push({ row, x: p[0], y: p[1] });
  }

  const cell = CLUSTER_CELL / k;
  const groups = new Map<string, { row: DbRow; x: number; y: number }[]>();
  for (const item of located) {
    const key = `${Math.floor(item.x / cell)},${Math.floor(item.y / cell)}`;
    const g = groups.get(key);
    if (g) g.push(item);
    else groups.set(key, [item]);
  }

  const dots: PersonDot[] = [];
  const clusters: Cluster[] = [];
  const badges: Badge[] = [];

  for (const [key, group] of groups) {
    const cx = group.reduce((s, d) => s + d.x, 0) / group.length;
    const cy = group.reduce((s, d) => s + d.y, 0) / group.length;
    const groupRows = group.map((g) => g.row);

    if (group.length === 1) {
      const { row, x, y } = group[0];
      dots.push({
        key: `${key}:${row.person.tg_id}`,
        x,
        y,
        r: dotRadius(row.person.closeness),
        row,
      });
      continue;
    }

    if (k < SPLIT_K) {
      badges.push({
        key,
        cx,
        cy,
        count: group.length,
        ids: sortedIds(groupRows),
        label: dominantLabel(groupRows),
      });
      continue;
    }

    // zoomed in: fan the group out at constant SCREEN spacing so every
    // person stays hoverable and clickable regardless of zoom level
    const members: PersonDot[] = group.map((item, i) => {
      const rPx = i === 0 ? 0 : (10 + 7 * Math.floor(i / 8)) / k;
      const ang = i * GOLDEN_ANGLE;
      return {
        key: `${key}:${item.row.person.tg_id}`,
        x: cx + rPx * Math.cos(ang),
        y: cy + rPx * Math.sin(ang),
        r: dotRadius(item.row.person.closeness),
        row: item.row,
      };
    });
    dots.push(...members);

    if (members.length >= CLUSTER_MIN) {
      const spread = Math.max(
        ...members.map((d) => Math.hypot(d.x - cx, d.y - cy) + d.r / k),
      );
      clusters.push({
        key,
        cx,
        cy,
        haloR: Math.max(12 / k, spread + 5 / k),
        count: members.length,
        ids: sortedIds(groupRows),
        label: dominantLabel(groupRows),
      });
    }
  }
  return { dots, clusters, badges, located: located.length };
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
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [transform, setTransform] = useState({ k: 1, tx: 0, ty: 0 });
  // pan bookkeeping — a real drag must not fire the click underneath
  const panRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const { k } = transform;
  const { dots, clusters, badges, located } = useMemo(
    () => buildMarkers(rows, k),
    [rows, k],
  );

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
    const sx = W / rect.width;
    const sy = H / rect.height;
    panRef.current = { x: e.clientX, y: e.clientY, moved: true };
    setTransform((t) => ({ ...t, tx: t.tx + dx * sx, ty: t.ty + dy * sy }));
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

  const groupHandlers = (key: string, label: string, count: number, ids: number[]) => ({
    onMouseEnter: (e: ReactMouseEvent) =>
      showTooltip(e, key, [label, `click to filter these ${count}`]),
    onMouseMove: (e: ReactMouseEvent) =>
      showTooltip(e, key, [label, `click to filter these ${count}`]),
    onMouseLeave: hideTooltip,
    onClick: () => {
      if (!wasDrag()) onClusterToggle(ids, label);
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
            {/* halos under the dots so individual dots keep winning hover/click */}
            {clusters.map((c) => (
              <circle
                key={`halo:${c.key}`}
                cx={c.cx}
                cy={c.cy}
                r={c.haloR}
                className="cursor-pointer fill-emerald-400/10 stroke-emerald-500/25"
                strokeWidth={0.75 / k}
                {...groupHandlers(`c:${c.key}`, c.label, c.count, c.ids)}
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
            {/* zoomed out: one badge counts the people in an area */}
            {badges.map((b) => (
              <g
                key={`b:${b.key}`}
                className="cursor-pointer"
                {...groupHandlers(`b:${b.key}`, b.label, b.count, b.ids)}
              >
                <circle
                  cx={b.cx}
                  cy={b.cy}
                  r={(b.count >= 10 ? 11 : 9) / k}
                  className={`fill-emerald-950/90 ${
                    hoverKey === `b:${b.key}` ? 'stroke-emerald-300' : 'stroke-emerald-500/80'
                  }`}
                  strokeWidth={1.25 / k}
                />
                <text
                  x={b.cx}
                  y={b.cy}
                  dy="0.35em"
                  textAnchor="middle"
                  fontSize={9 / k}
                  className="pointer-events-none fill-emerald-300 font-semibold"
                >
                  {b.count}
                </text>
              </g>
            ))}
            {/* zoomed in: the fanned-out groups keep a small count chip */}
            {clusters.map((c) => (
              <g
                key={`chip:${c.key}`}
                className="cursor-pointer"
                {...groupHandlers(`c:${c.key}`, c.label, c.count, c.ids)}
              >
                <circle
                  cx={c.cx}
                  cy={c.cy - c.haloR - 8 / k}
                  r={7.5 / k}
                  className={`fill-slate-950 ${
                    hoverKey === `c:${c.key}` ? 'stroke-emerald-300' : 'stroke-emerald-600/80'
                  }`}
                  strokeWidth={1 / k}
                />
                <text
                  x={c.cx}
                  y={c.cy - c.haloR - 8 / k}
                  dy="0.35em"
                  textAnchor="middle"
                  fontSize={8 / k}
                  className="pointer-events-none fill-emerald-300 font-semibold"
                >
                  {c.count}
                </text>
              </g>
            ))}
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
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
          <span className="h-3 w-3 rounded-full bg-emerald-400/80" />
          size = closeness
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-emerald-600/80 bg-slate-950 text-[8px] font-semibold text-emerald-300">
            n
          </span>
          people in one area. Click to filter, zoom in to see each person
        </span>
        <span className="ml-auto truncate">dots only where evidence has coordinates</span>
      </div>
    </div>
  );
}
