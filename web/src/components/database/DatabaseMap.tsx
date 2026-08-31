'use client';

// Map panel — dots only where the enrichment card carries evidence
// coordinates. Honest by construction: no geocoding guesses client-side, so
// unverified rows simply have no dot.
//
// A faithful port of atlas-crm's AtlasMap (MapLibre + supercluster) onto our
// self-contained SVG globe, including the two details that make it feel
// right:
//   1. every size is in REAL SCREEN PIXELS (the SVG's on-screen scale is
//      measured with a ResizeObserver), so circles and dots stay readable at
//      any zoom on any panel width;
//   2. clustering has a max zoom (atlas clusterMaxZoom): zoomed out, people
//      merge into count circles that can span a whole country; zoomed past
//      CLUSTER_MAX_K the clusters are gone and every PERSON is an individual
//      clickable dot (same-city people fan out at constant screen spacing).
// Clicking a count circle filters all views to exactly those people (the
// dismissible pill up top); clicking a person dot opens their table row.
// Scroll zooms around the pointer, drag pans, zoom-out goes past 1x so a
// continent can collapse into one number.

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

const CLUSTER_RADIUS_PX = 44; // real screen px — the atlas clusterRadius
const CLUSTER_MAX_K = 10; // atlas clusterMaxZoom: past this, people, not circles
const LABEL_K = 3; // place names appear from this zoom level
const GOLDEN_ANGLE = 2.39996;
const MIN_K = 0.35; // zoom out far enough that a continent is one number
const MAX_K = 40;
const DOT_R_PX = 5.5; // person dot, atlas pt-core
const DOT_GLOW_PX = 11; // atlas pt-glow
const DOT_HIT_PX = 13; // invisible hit target so dots are easy to click

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

interface DotMarker {
  key: string;
  x: number;
  y: number;
  row: DbRow;
}

interface ClusterMarker {
  key: string;
  x: number;
  y: number;
  count: number;
  ids: number[];
  city: string | null;
}

interface PlaceLabel {
  key: string;
  x: number;
  y: number; // below the marker/fan it belongs to
  text: string;
}

/** atlas cluster-core radius (real px): linear interpolation on the count */
function clusterRadiusPx(count: number): number {
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

/** one projected point per located person, deterministic order */
function toPoints(rows: DbRow[]): MapPoint[] {
  const out: MapPoint[] = [];
  const sorted = [...rows].sort((a, b) => a.person.tg_id - b.person.tg_id);
  for (const row of sorted) {
    const lat = row.card?.location_lat;
    const lng = row.card?.location_lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const p = projection([lng, lat]);
    if (!p) continue;
    out.push({ row, x: p[0], y: p[1] });
  }
  return out;
}

function dominantCity(points: MapPoint[]): string | null {
  const counts = new Map<string, number>();
  for (const p of points) {
    const c = cityOf(p.row);
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

/**
 * The atlas marker model. `unitsPerPx` converts real screen px to viewBox
 * units at the current zoom, so both the cluster radius and the fan spacing
 * are constant on screen.
 */
function buildMarkers(
  points: MapPoint[],
  k: number,
  unitsPerPx: number,
): { dots: DotMarker[]; clusters: ClusterMarker[]; labels: PlaceLabel[] } {
  const dots: DotMarker[] = [];
  const clusters: ClusterMarker[] = [];
  const labels: PlaceLabel[] = [];

  if (k <= CLUSTER_MAX_K) {
    // supercluster mode: greedy radius merge at 44 real px
    const r = CLUSTER_RADIUS_PX * unitsPerPx;
    const groups: { x: number; y: number; points: MapPoint[] }[] = [];
    for (const pt of points) {
      let best: (typeof groups)[number] | null = null;
      let bestD = Infinity;
      for (const g of groups) {
        const d = Math.hypot(g.x - pt.x, g.y - pt.y);
        if (d < r && d < bestD) {
          best = g;
          bestD = d;
        }
      }
      if (best) {
        best.points.push(pt);
        best.x = best.points.reduce((s, p) => s + p.x, 0) / best.points.length;
        best.y = best.points.reduce((s, p) => s + p.y, 0) / best.points.length;
      } else {
        groups.push({ x: pt.x, y: pt.y, points: [pt] });
      }
    }
    for (const g of groups) {
      if (g.points.length === 1) {
        const { row } = g.points[0];
        dots.push({ key: `p:${row.person.tg_id}`, x: g.x, y: g.y, row });
        continue;
      }
      const city = dominantCity(g.points);
      const c: ClusterMarker = {
        key: `c:${g.points[0].row.person.tg_id}`,
        x: g.x,
        y: g.y,
        count: g.points.length,
        ids: g.points.map((p) => p.row.person.tg_id).sort((a, b) => a - b),
        city,
      };
      clusters.push(c);
      if (k >= LABEL_K && city) {
        labels.push({
          key: c.key,
          x: g.x,
          y: g.y + (clusterRadiusPx(c.count) + 10) * unitsPerPx,
          text: city,
        });
      }
    }
    return { dots, clusters, labels };
  }

  // person mode (past clusterMaxZoom): every human is an individual dot;
  // same-place people fan out golden-angle at constant SCREEN spacing
  const cell = 16 * unitsPerPx;
  const groups = new Map<string, MapPoint[]>();
  for (const pt of points) {
    const key = `${Math.round(pt.x / cell)},${Math.round(pt.y / cell)}`;
    const g = groups.get(key);
    if (g) g.push(pt);
    else groups.set(key, [pt]);
  }
  for (const group of groups.values()) {
    const cx = group.reduce((s, p) => s + p.x, 0) / group.length;
    const cy = group.reduce((s, p) => s + p.y, 0) / group.length;
    let fanMax = 0;
    group.forEach((pt, i) => {
      const rPx = group.length === 1 || i === 0 ? 0 : 15 + 10 * Math.floor((i - 1) / 8);
      fanMax = Math.max(fanMax, rPx);
      const ang = i * GOLDEN_ANGLE;
      dots.push({
        key: `p:${pt.row.person.tg_id}`,
        x: cx + rPx * unitsPerPx * Math.cos(ang),
        y: cy + rPx * unitsPerPx * Math.sin(ang),
        row: pt.row,
      });
    });
    const city = dominantCity(group);
    if (city) {
      labels.push({
        key: `l:${group[0].row.person.tg_id}`,
        x: cx,
        y: cy + (fanMax + DOT_R_PX + 10) * unitsPerPx,
        text: city,
      });
    }
  }
  return { dots, clusters, labels };
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
  /** click on a person dot — opens their table row */
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
  // how many real screen px one viewBox unit takes (panel-width dependent)
  const [displayScale, setDisplayScale] = useState(0.45);
  // pan bookkeeping — a real drag must not fire the click underneath
  const panRef = useRef<{ x: number; y: number; id: number; moved: boolean } | null>(null);

  const { k } = transform;
  // real px → viewBox units at the current zoom
  const unitsPerPx = 1 / (displayScale * k);
  const points = useMemo(() => toPoints(rows), [rows]);
  const { dots, clusters, labels } = useMemo(
    () => buildMarkers(points, k, unitsPerPx),
    [points, k, unitsPerPx],
  );
  const located = points.length;

  // measure the SVG's on-screen scale so sizes are true screen px (atlas is
  // a GL canvas and gets this for free; our SVG has to measure)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const update = () => {
      const rect = svg.getBoundingClientRect();
      if (rect.width > 0) setDisplayScale(rect.width / W);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

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
    // NO pointer capture here: capturing on pointerdown retargets pointerup
    // to the svg, which makes the browser aim the click at the svg instead
    // of the marker under the cursor — marker clicks silently die. Capture
    // begins only once movement actually becomes a drag (see onPointerMove).
    panRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    const svg = svgRef.current;
    if (!pan || !svg) return;
    const dx = e.clientX - pan.x;
    const dy = e.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < 5) return;
    if (!pan.moved) {
      try {
        svg.setPointerCapture(pan.id);
      } catch {
        /* pointer may be gone */
      }
    }
    pan.moved = true;
    const rect = svg.getBoundingClientRect();
    panRef.current = { ...pan, x: e.clientX, y: e.clientY, moved: true };
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
    <div className="flex h-[260px] flex-col rounded-lg border border-slate-800 glass sm:h-[320px] xl:h-[360px]">
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
                onMouseEnter={(e) => showTooltip(e, dot.key, personLines(dot.row))}
                onMouseMove={(e) => showTooltip(e, dot.key, personLines(dot.row))}
                onMouseLeave={hideTooltip}
                onClick={() => {
                  if (!wasDrag()) onSelect(dot.row.person.tg_id);
                }}
                className="cursor-pointer"
              >
                {/* atlas pt-glow + pt-core, tier-colored, plus a generous
                    invisible hit circle so a dot never needs pixel aim */}
                <circle
                  cx={dot.x}
                  cy={dot.y}
                  r={DOT_GLOW_PX * unitsPerPx}
                  className={tierClass(dot.row.person.closeness)}
                  opacity={0.3}
                />
                <circle
                  cx={dot.x}
                  cy={dot.y}
                  r={DOT_R_PX * unitsPerPx}
                  className={`${tierClass(dot.row.person.closeness)} ${
                    hoverKey === dot.key ? 'stroke-slate-100' : 'stroke-slate-950'
                  }`}
                  strokeWidth={1 * unitsPerPx}
                />
                <circle
                  cx={dot.x}
                  cy={dot.y}
                  r={DOT_HIT_PX * unitsPerPx}
                  fill="transparent"
                />
              </g>
            ))}
            {clusters.map((c) => {
              const r = clusterRadiusPx(c.count) * unitsPerPx;
              const label = c.city ? `${c.count} in and around ${c.city}` : `${c.count} contacts`;
              return (
                <g
                  key={c.key}
                  className="cursor-pointer"
                  onMouseEnter={(e) => showTooltip(e, c.key, [label, 'click to filter'])}
                  onMouseMove={(e) => showTooltip(e, c.key, [label, 'click to filter'])}
                  onMouseLeave={hideTooltip}
                  onClick={() => {
                    if (!wasDrag()) onClusterToggle(c.ids, label);
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
                    strokeWidth={1.5 * unitsPerPx}
                  />
                  <text
                    x={c.x}
                    y={c.y}
                    dy="0.35em"
                    textAnchor="middle"
                    fontSize={12 * unitsPerPx}
                    className="pointer-events-none fill-emerald-200 font-semibold"
                  >
                    {c.count}
                  </text>
                </g>
              );
            })}
            {labels.map((l) => (
              <text
                key={l.key}
                x={l.x}
                y={l.y}
                textAnchor="middle"
                fontSize={10 * unitsPerPx}
                className="pointer-events-none fill-slate-400"
              >
                {l.text}
              </text>
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
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-emerald-500/90 bg-emerald-950 text-[8px] font-semibold text-emerald-200">
            n
          </span>
          people in an area. Click to filter, zoom in until every person is a dot
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
