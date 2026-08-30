'use client';

// Map panel — dots only where the enrichment card carries evidence
// coordinates. Honest by construction: no geocoding guesses client-side, so
// unverified rows simply have no dot.
//
// The marker model is a port of atlas-crm's AtlasMap (MapLibre supercluster)
// onto our self-contained SVG globe: every person is one point (same-city
// people get a deterministic golden-angle ring in degree space, exactly like
// atlas toFeatures), and points within a 44-screen-px radius merge into ONE
// count circle. Zooming re-buckets continuously — zoomed out a circle spans
// a country, zoomed in it tightens to a city (and never splinters into loose
// dots next to a circle). Clicking a circle filters to exactly those people,
// labeled by their dominant city; a lone person is a small fixed-size dot,
// tier-colored by closeness, that opens their table row. Scroll zooms,
// drag pans.

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

const CLUSTER_RADIUS = 44; // screen px — the atlas clusterRadius
const LABEL_K = 2.2; // dominant-city names appear on circles from this zoom
const GOLDEN_ANGLE = 2.39996;
const MIN_K = 1;
const MAX_K = 80; // deep enough that neighboring cities un-merge (Bay Area)

// same closeness tiers as the graph's rings (80+/55+), atlas TIER_COLOR idea
function tierClass(closeness: number): string {
  if (closeness >= 80) return 'fill-emerald-400';
  if (closeness >= 55) return 'fill-sky-400';
  return 'fill-slate-500';
}

interface MapPoint {
  row: DbRow;
  x: number;
  y: number;
}

interface Cluster {
  key: string;
  x: number;
  y: number;
  points: MapPoint[];
}

/** atlas cluster-core radius: linear interpolation on the member count */
function clusterRadius(count: number): number {
  const stops: [number, number][] = [
    [2, 13],
    [25, 22],
    [60, 32],
  ];
  if (count <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [c1, r1] = stops[i - 1];
    const [c2, r2] = stops[i];
    if (count <= c2) return r1 + ((count - c1) / (c2 - c1)) * (r2 - r1);
  }
  return stops[stops.length - 1][1];
}

/** one point per person; same-coordinate people ring-scattered like atlas */
function toPoints(rows: DbRow[]): MapPoint[] {
  const byCoord = new Map<string, number>();
  const out: MapPoint[] = [];
  const sorted = [...rows].sort((a, b) => a.person.tg_id - b.person.tg_id);
  for (const row of sorted) {
    const lat = row.card?.location_lat;
    const lng = row.card?.location_lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const key = `${lat},${lng}`;
    const n = byCoord.get(key) ?? 0;
    byCoord.set(key, n + 1);
    const ring = n === 0 ? 0 : 0.04 + 0.012 * Math.floor((n - 1) / 8);
    const ang = (n * GOLDEN_ANGLE) % (Math.PI * 2);
    const p = projection([lng + ring * Math.cos(ang), lat + ring * Math.sin(ang)]);
    if (!p) continue;
    out.push({ row, x: p[0], y: p[1] });
  }
  return out;
}

/** greedy radius clustering — the supercluster behavior, small-n edition */
function buildClusters(points: MapPoint[], k: number): Cluster[] {
  const r = CLUSTER_RADIUS / k;
  const clusters: Cluster[] = [];
  for (const pt of points) {
    let best: Cluster | null = null;
    let bestD = Infinity;
    for (const c of clusters) {
      const d = Math.hypot(c.x - pt.x, c.y - pt.y);
      if (d < r && d < bestD) {
        best = c;
        bestD = d;
      }
    }
    if (best) {
      best.points.push(pt);
      // centroid update keeps the circle over its members as it grows
      best.x = best.points.reduce((s, p) => s + p.x, 0) / best.points.length;
      best.y = best.points.reduce((s, p) => s + p.y, 0) / best.points.length;
    } else {
      clusters.push({ key: `c:${pt.row.person.tg_id}`, x: pt.x, y: pt.y, points: [pt] });
    }
  }
  return clusters;
}

function dominantCity(points: MapPoint[]): string | null {
  const counts = new Map<string, number>();
  for (const p of points) {
    const c = cityOf(p.row);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [c, kk] of counts) {
    if (kk > n) {
      n = kk;
      best = c;
    }
  }
  return best;
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
  /** click on a lone person dot — opens their table row */
  onSelect: (tgId: number) => void;
  /** click on a count circle — filter to exactly these people (atlas gesture) */
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
  const points = useMemo(() => toPoints(rows), [rows]);
  const clusters = useMemo(() => buildClusters(points, k), [points, k]);
  const located = points.length;

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
        const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25;
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

  const personLines = (row: DbRow): string[] => {
    const lines = [
      row.person.name.trim() === '' ? '(unnamed)' : displayName(row.person.name, masked),
    ];
    const company = companyOf(row).name;
    if (company) lines.push(company);
    if (row.card?.location) lines.push(row.card.location);
    return lines;
  };

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
            {clusters.map((c) => {
              if (c.points.length === 1) {
                const { row } = c.points[0];
                const key = `p:${row.person.tg_id}`;
                return (
                  <g
                    key={key}
                    onMouseEnter={(e) => showTooltip(e, key, personLines(row))}
                    onMouseMove={(e) => showTooltip(e, key, personLines(row))}
                    onMouseLeave={hideTooltip}
                    onClick={() => {
                      if (!wasDrag()) onSelect(row.person.tg_id);
                    }}
                    className="cursor-pointer"
                  >
                    {/* fixed-size tier-colored dot + soft glow, atlas pt layers */}
                    <circle
                      cx={c.x}
                      cy={c.y}
                      r={10 / k}
                      className={tierClass(row.person.closeness)}
                      opacity={0.25}
                    />
                    <circle
                      cx={c.x}
                      cy={c.y}
                      r={5 / k}
                      className={`${tierClass(row.person.closeness)} ${
                        hoverKey === key ? 'stroke-slate-100' : 'stroke-slate-950'
                      }`}
                      strokeWidth={1 / k}
                    />
                  </g>
                );
              }
              const count = c.points.length;
              const r = clusterRadius(count) / k;
              const city = dominantCity(c.points);
              const label = city ? `${count} in and around ${city}` : `${count} contacts`;
              const ids = c.points.map((p) => p.row.person.tg_id).sort((a, b) => a - b);
              return (
                <g
                  key={c.key}
                  className="cursor-pointer"
                  onMouseEnter={(e) => showTooltip(e, c.key, [label, 'click to filter'])}
                  onMouseMove={(e) => showTooltip(e, c.key, [label, 'click to filter'])}
                  onMouseLeave={hideTooltip}
                  onClick={() => {
                    if (!wasDrag()) onClusterToggle(ids, label);
                  }}
                >
                  {/* atlas cluster-glow + cluster-core + count */}
                  <circle cx={c.x} cy={c.y} r={r * 1.7} className="fill-emerald-500/15" />
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={r}
                    className={`fill-emerald-950/95 ${
                      hoverKey === c.key ? 'stroke-emerald-200' : 'stroke-emerald-400/90'
                    }`}
                    strokeWidth={1.5 / k}
                  />
                  <text
                    x={c.x}
                    y={c.y}
                    dy="0.35em"
                    textAnchor="middle"
                    fontSize={11 / k}
                    className="pointer-events-none fill-emerald-200 font-semibold"
                  >
                    {count}
                  </text>
                  {k >= LABEL_K && city && (
                    <text
                      x={c.x}
                      y={c.y + r + 10 / k}
                      textAnchor="middle"
                      fontSize={9 / k}
                      className="pointer-events-none fill-slate-400"
                    >
                      {city}
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
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-emerald-500/90 bg-emerald-950 text-[8px] font-semibold text-emerald-200">
            n
          </span>
          people near each other. Click to filter, zoom to split areas apart
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          one person. Click to open their row
        </span>
        <span className="ml-auto truncate">dots only where evidence has coordinates</span>
      </div>
    </div>
  );
}
