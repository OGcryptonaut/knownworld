'use client';

// Network graph panel with three lenses (idea from the owner's atlas-crm
// reference): COMPANIES (who works where), CITIES (where they are), and
// CLOSENESS (You at the center, contacts settle onto three warmth rings).
// Inferred affiliations stay visually distinct (dashed) from definite ones —
// the two are never merged into one edge style. Atlas doctrine: hubs are
// selection/drill-down (click toggles the page-wide filter), person nodes
// are navigation (click selects that person's table row below).

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';
import { cityOf, companyOf, type DbRow, type DbSelection } from './shared';

const W = 900;
const H = 470;
const PAD = 40;
const TICKS = 300;
const MODE_KEY = 'kw-graph-mode';

type GraphMode = 'companies' | 'cities' | 'closeness';
const MODES: { key: GraphMode; label: string }[] = [
  { key: 'companies', label: 'Companies' },
  { key: 'cities', label: 'Cities' },
  { key: 'closeness', label: 'Closeness' },
];

// closeness mode has ring guides, not hub nodes — nothing to click there
const HUB_DIM: Record<GraphMode, 'company' | 'city' | null> = {
  companies: 'company',
  cities: 'city',
  closeness: null,
};

// closeness tiers, atlas-style: ring 1 is people you actually talk to
const RING_RADII = [80, 160, 235];
function tierOf(closeness: number): number {
  if (closeness >= 80) return 0;
  if (closeness >= 55) return 1;
  return 2;
}

interface GNode extends SimulationNodeDatum {
  id: string;
  kind: 'you' | 'hub' | 'person';
  label: string; // raw — person labels masked at render time
  r: number;
  tgId?: number;
}

interface GLink extends SimulationLinkDatum<GNode> {
  kind: 'affiliation' | 'hub';
  inferred: boolean;
}

interface Layout {
  nodes: GNode[];
  links: GLink[];
}

function personRadius(closeness: number): number {
  return 4 + (Math.max(0, Math.min(100, closeness)) / 100) * 6;
}

function buildLayout(rows: DbRow[], mode: GraphMode): Layout {
  const nodes: GNode[] = [{ id: 'you', kind: 'you', label: 'You', r: 12, fx: 0, fy: 0 }];
  const links: GLink[] = [];
  const hubIds = new Map<string, string>();
  const isolated = new Set<string>();
  const personTier = new Map<string, number>();

  if (mode !== 'closeness') {
    for (const row of rows) {
      const hub = mode === 'companies' ? companyOf(row).name : cityOf(row);
      if (hub && !hubIds.has(hub)) {
        const id = `h:${hub}`;
        hubIds.set(hub, id);
        nodes.push({ id, kind: 'hub', label: hub, r: 6 });
        links.push({ source: id, target: 'you', kind: 'hub', inferred: false });
      }
    }
  }

  for (const row of rows) {
    const { person } = row;
    const id = `p:${person.tg_id}`;
    nodes.push({
      id,
      kind: 'person',
      label: person.name,
      r: personRadius(person.closeness),
      tgId: person.tg_id,
    });
    if (mode === 'closeness') {
      personTier.set(id, tierOf(person.closeness));
      links.push({ source: id, target: 'you', kind: 'affiliation', inferred: false });
      continue;
    }
    const hub = mode === 'companies' ? companyOf(row).name : cityOf(row);
    const inferred = mode === 'companies' ? companyOf(row).inferred : false;
    if (hub) {
      links.push({ source: id, target: hubIds.get(hub)!, kind: 'affiliation', inferred });
    } else {
      isolated.add(id);
    }
  }

  const sim = forceSimulation<GNode>(nodes)
    .force(
      'link',
      forceLink<GNode, GLink>(links)
        .id((d) => d.id)
        .distance((l) => {
          if (mode === 'closeness') {
            const s = l.source as GNode;
            return RING_RADII[personTier.get(s.id) ?? 2];
          }
          return l.kind === 'hub' ? 120 : 40;
        })
        .strength(mode === 'closeness' ? 0.05 : 1),
    )
    .force('charge', forceManyBody<GNode>().strength(-90))
    .force('center', forceCenter<GNode>(0, 0))
    // extra padding around person nodes so the always-on name labels breathe
    .force('collide', forceCollide<GNode>().radius((d) => d.r + (d.kind === 'person' ? 11 : 5)))
    .force(
      'rim',
      forceRadial<GNode>(
        (d) =>
          mode === 'closeness' ? RING_RADII[personTier.get(d.id) ?? 2] : 240,
      ).strength((d) => {
        if (d.kind !== 'person') return 0;
        if (mode === 'closeness') return 0.9;
        return isolated.has(d.id) ? 0.08 : 0;
      }),
    )
    .stop();
  for (let i = 0; i < TICKS; i += 1) sim.tick();

  // fit the settled layout into the viewBox
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x ?? 0);
    maxX = Math.max(maxX, n.x ?? 0);
    minY = Math.min(minY, n.y ?? 0);
    maxY = Math.max(maxY, n.y ?? 0);
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY, 1.6);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (const n of nodes) {
    n.x = W / 2 + ((n.x ?? 0) - cx) * scale;
    n.y = H / 2 + ((n.y ?? 0) - cy) * scale;
  }

  return { nodes, links };
}

export function DatabaseGraph({
  rows,
  selection,
  onSelect,
  onHubToggle,
}: {
  rows: DbRow[];
  selection: DbSelection | null;
  onSelect: (tgId: number) => void;
  onHubToggle: (dim: 'company' | 'city', value: string) => void;
}) {
  const { masked } = usePrivacy();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [transform, setTransform] = useState({ k: 1, tx: 0, ty: 0 });
  const [mode, setMode] = useState<GraphMode>('companies');
  // pan bookkeeping — a real drag must not fire the node click underneath
  const panRef = useRef<{ x: number; y: number; id: number; moved: boolean } | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(MODE_KEY) as GraphMode | null;
      if (stored && MODES.some((m) => m.key === stored)) setMode(stored);
    } catch {
      /* ignore */
    }
  }, []);

  const pickMode = (m: GraphMode) => {
    setMode(m);
    setTransform({ k: 1, tx: 0, ty: 0 });
    try {
      window.localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  };

  const layout = useMemo(() => buildLayout(rows, mode), [rows, mode]);
  const empty = rows.length === 0;
  const hubDim = HUB_DIM[mode];

  // Names are visible up front, not only on hover. On big networks labeling
  // everyone turns to soup, so the closest 40 keep labels and the rest show
  // theirs on hover.
  const labeledIds = useMemo(() => {
    const persons = layout.nodes.filter((n) => n.kind === 'person');
    if (persons.length <= 60) return new Set(persons.map((n) => n.id));
    return new Set(
      [...persons]
        .sort((a, b) => b.r - a.r)
        .slice(0, 40)
        .map((n) => n.id),
    );
  }, [layout]);

  const isSelectedHub = (n: GNode): boolean =>
    n.kind === 'hub' &&
    selection?.kind === 'hub' &&
    selection.dim === hubDim &&
    selection.value === n.label;

  // persons shown are pre-filtered to the selection, so with a hub selection
  // active only non-selected hubs remain to dim (cross-lens context)
  const isDimmed = (n: GNode): boolean =>
    selection?.kind === 'hub' && n.kind === 'hub' && !isSelectedHub(n);

  // the "you" node lands at the fitted center — ring guides draw around it
  const youNode = layout.nodes[0];

  // wheel zoom around the pointer; non-passive so the page does not scroll.
  // keyed on `empty` so the listener attaches if the svg mounts later.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const py = ((e.clientY - rect.top) / rect.height) * H;
      setTransform((t) => {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const k = Math.max(0.5, Math.min(4, t.k * factor));
        const applied = k / t.k;
        return { k, tx: px - applied * (px - t.tx), ty: py - applied * (py - t.ty) };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [empty]);

  const nodeLabel = (n: GNode): string => {
    if (n.kind !== 'person') return n.label;
    return n.label.trim() === '' ? '(unnamed)' : displayName(n.label, masked);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    // NO pointer capture here: capturing on pointerdown retargets pointerup
    // to the svg, so the browser aims the click at the svg instead of the
    // node — hub/person clicks silently die. Capture starts only once the
    // movement is really a drag (see onPointerMove).
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
    // cleared on the next tick so node click handlers can still see `moved`
    setTimeout(() => {
      panRef.current = null;
    }, 0);
  };
  const wasDrag = () => panRef.current?.moved === true;

  return (
    <div className="flex h-[260px] flex-col rounded-lg border border-slate-800 bg-slate-900/40 sm:h-[320px] xl:h-[360px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-800/80 px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Network graph
        </span>
        <div className="flex items-center gap-1">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => pickMode(m.key)}
              aria-pressed={mode === m.key}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                mode === m.key
                  ? 'border-emerald-700 bg-emerald-950/60 text-emerald-300'
                  : 'border-slate-700 text-slate-400 hover:border-slate-500'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-slate-500">
          {hubDim ? 'click a hub to filter · ' : ''}scroll to zoom · drag to pan
        </span>
      </div>

      {empty ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <p className="text-sm text-slate-400">
            {selection
              ? 'No people match the current selection.'
              : 'No people yet. Distill your chats first.'}
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 p-1">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid meet"
            className="h-full w-full cursor-grab active:cursor-grabbing"
            role="img"
            aria-label="Network graph"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPan}
            onPointerCancel={endPan}
          >
            <g transform={`translate(${transform.tx},${transform.ty}) scale(${transform.k})`}>
              {mode === 'closeness' &&
                RING_RADII.map((r, i) => (
                  <circle
                    key={i}
                    cx={youNode?.x ?? W / 2}
                    cy={youNode?.y ?? H / 2}
                    r={r * 0.9}
                    fill="none"
                    className="stroke-slate-800"
                    strokeDasharray="3 5"
                  />
                ))}
              {layout.links.map((l, i) => {
                const s = l.source as GNode;
                const t = l.target as GNode;
                return (
                  <line
                    key={i}
                    x1={s.x}
                    y1={s.y}
                    x2={t.x}
                    y2={t.y}
                    strokeDasharray={l.inferred ? '4 3' : undefined}
                    className={l.kind === 'hub' ? 'stroke-slate-800' : 'stroke-slate-700'}
                    strokeWidth={l.kind === 'hub' ? 1.25 : 1}
                    strokeOpacity={mode === 'closeness' ? 0.35 : 1}
                  />
                );
              })}
              {layout.nodes.map((n) => (
                <g
                  key={n.id}
                  opacity={isDimmed(n) ? 0.45 : undefined}
                  onMouseEnter={() => setHoverId(n.id)}
                  onMouseLeave={() => setHoverId(null)}
                  onClick={() => {
                    if (wasDrag()) return;
                    if (n.kind === 'person' && n.tgId !== undefined) onSelect(n.tgId);
                    else if (n.kind === 'hub' && hubDim) onHubToggle(hubDim, n.label);
                  }}
                  className={
                    n.kind === 'person' || (n.kind === 'hub' && hubDim)
                      ? 'cursor-pointer'
                      : 'cursor-default'
                  }
                >
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.r}
                    strokeWidth={1.5}
                    className={
                      n.kind === 'you'
                        ? 'fill-emerald-400 stroke-emerald-200'
                        : n.kind === 'hub'
                          ? isSelectedHub(n)
                            ? 'fill-slate-600 stroke-emerald-400'
                            : `fill-slate-600 ${hoverId === n.id ? 'stroke-slate-300' : 'stroke-transparent'}`
                          : `fill-emerald-500/70 ${hoverId === n.id ? 'stroke-emerald-200' : 'stroke-transparent'}`
                    }
                  />
                  {(n.kind === 'you' ||
                    n.kind === 'hub' ||
                    (n.kind === 'person' &&
                      (labeledIds.has(n.id) || hoverId === n.id))) && (
                    <text
                      x={n.x}
                      y={(n.y ?? 0) - n.r - 4}
                      textAnchor="middle"
                      className={
                        n.kind === 'you'
                          ? 'fill-emerald-300 text-[11px] font-medium'
                          : n.kind === 'hub'
                            ? isSelectedHub(n)
                              ? 'fill-emerald-300 text-[10px] font-medium'
                              : 'fill-slate-300 text-[10px]'
                            : 'fill-slate-200 text-[10px]'
                      }
                    >
                      {nodeLabel(n)}
                    </text>
                  )}
                </g>
              ))}
            </g>
          </svg>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-800/80 px-3 py-1.5 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
          contact (size = closeness)
        </span>
        {mode === 'closeness' ? (
          <span>inner ring = closest (80+), middle 55+, outer the rest</span>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
              {mode === 'companies' ? 'company' : 'city'} · click to filter
            </span>
            {mode === 'companies' && (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-px w-6 bg-slate-700" />
                  definite
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-px w-6"
                    style={{
                      backgroundImage:
                        'repeating-linear-gradient(to right, var(--color-slate-500) 0 4px, transparent 4px 7px)',
                    }}
                  />
                  inferred
                </span>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
