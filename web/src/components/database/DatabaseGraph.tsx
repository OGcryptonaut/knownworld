'use client';

// Network graph panel with four lenses, matching the atlas-crm graph model:
// COMPANIES / CITIES / TAGS are pure bipartite cluster views — contacts
// gather AROUND their hub (a company, a city, a tag), hubs need 2+ members
// to exist (atlas rule), people with no surviving hub float as smaller
// orphans, and there is NO central "you" node. CLOSENESS is the atlas
// proximity lens: You at the center, contacts settle onto three warmth
// rings. Inferred affiliations stay visually distinct (dashed) from
// definite ones. Atlas doctrine: hubs are selection/drill-down (click
// toggles the page-wide filter), person nodes are navigation (click opens
// that person's card below and scrolls to it).

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
import { cityOf, companyOf, tagsOf, type DbRow, type DbSelection } from './shared';

const W = 900;
const H = 470;
const PAD = 40;
const TICKS = 300;
const MODE_KEY = 'kw-graph-mode';

type GraphMode = 'companies' | 'cities' | 'tags' | 'closeness';
const MODES: { key: GraphMode; label: string }[] = [
  { key: 'companies', label: 'Companies' },
  { key: 'cities', label: 'Cities' },
  { key: 'tags', label: 'Tags' },
  { key: 'closeness', label: 'Closeness' },
];

// closeness mode has ring guides, not hub nodes — nothing to click there
const HUB_DIM: Record<GraphMode, 'company' | 'city' | 'tag' | null> = {
  companies: 'company',
  cities: 'city',
  tags: 'tag',
  closeness: null,
};

// atlas rule: a hub earns its node with 2+ members; loners float as orphans
const HUB_MIN_MEMBERS = 2;

/** hub keys for one row under a lens (tags can attach a person to several) */
function hubsOf(row: DbRow, mode: GraphMode): { key: string; inferred: boolean }[] {
  if (mode === 'companies') {
    const c = companyOf(row);
    return c.name ? [{ key: c.name, inferred: c.inferred }] : [];
  }
  if (mode === 'cities') {
    const c = cityOf(row);
    return c ? [{ key: c, inferred: false }] : [];
  }
  if (mode === 'tags') {
    return tagsOf(row).map((t) => ({ key: t, inferred: false }));
  }
  return [];
}

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
  /** the fit scale positions were multiplied by — ring guides need it too */
  scale: number;
}


/** True on-screen geometry of a `meet` SVG: uniform scale + letterbox. */
function viewOf(rect: DOMRect): { s: number; ox: number; oy: number } {
  const s = Math.min(rect.width / W, rect.height / H);
  return { s, ox: (rect.width - W * s) / 2, oy: (rect.height - H * s) / 2 };
}

function personRadius(closeness: number): number {
  return 4 + (Math.max(0, Math.min(100, closeness)) / 100) * 6;
}

function buildLayout(rows: DbRow[], mode: GraphMode): Layout {
  const nodes: GNode[] = [];
  const links: GLink[] = [];
  const isolated = new Set<string>();
  const personTier = new Map<string, number>();

  if (mode === 'closeness') {
    // atlas proximity lens: You at the center, warmth rings around
    nodes.push({ id: 'you', kind: 'you', label: 'You', r: 12, fx: 0, fy: 0 });
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
      personTier.set(id, tierOf(person.closeness));
      links.push({ source: id, target: 'you', kind: 'affiliation', inferred: false });
    }
  } else {
    // atlas bipartite lens: contacts gather AROUND their hubs; no center
    // node, and a hub only exists with 2+ members — loners float as
    // smaller orphan dots at the rim
    const memberships = new Map<string, { tgId: number; inferred: boolean }[]>();
    for (const row of rows) {
      for (const h of hubsOf(row, mode)) {
        const list = memberships.get(h.key) ?? [];
        list.push({ tgId: row.person.tg_id, inferred: h.inferred });
        memberships.set(h.key, list);
      }
    }
    const linkedPersons = new Set<number>();
    for (const [key, members] of memberships) {
      if (members.length < HUB_MIN_MEMBERS) continue;
      const id = `h:${key}`;
      // atlas hub size: 7 + min(members, 18)
      nodes.push({ id, kind: 'hub', label: key, r: 7 + Math.min(members.length, 18) });
      for (const m of members) {
        links.push({ source: `p:${m.tgId}`, target: id, kind: 'affiliation', inferred: m.inferred });
        linkedPersons.add(m.tgId);
      }
    }
    for (const row of rows) {
      const { person } = row;
      const id = `p:${person.tg_id}`;
      const clustered = linkedPersons.has(person.tg_id);
      nodes.push({
        id,
        kind: 'person',
        label: person.name,
        // atlas: orphans render slightly smaller than clustered people
        r: clustered ? personRadius(person.closeness) : Math.max(3.5, personRadius(person.closeness) - 2),
        tgId: person.tg_id,
      });
      if (!clustered) isolated.add(id);
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
          return 42; // person orbiting its hub
        })
        .strength(mode === 'closeness' ? 0.05 : 0.7),
    )
    .force('charge', forceManyBody<GNode>().strength(mode === 'closeness' ? -90 : -70))
    .force('center', forceCenter<GNode>(0, 0))
    // extra padding around person nodes so the always-on name labels breathe
    .force('collide', forceCollide<GNode>().radius((d) => d.r + (d.kind === 'person' ? 11 : 8)))
    .force(
      'rim',
      forceRadial<GNode>(
        (d) =>
          mode === 'closeness' ? RING_RADII[personTier.get(d.id) ?? 2] : 250,
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

  return { nodes, links, scale };
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
  onHubToggle: (dim: 'company' | 'city' | 'tag', value: string) => void;
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
    ((selection?.kind === 'hub' && selection.dim === hubDim && selection.value === n.label) ||
      (selection?.kind === 'tag' && hubDim === 'tag' && selection.value === n.label));

  // persons shown are pre-filtered to the selection, so with a hub selection
  // active only non-selected hubs remain to dim (cross-lens context)
  const isDimmed = (n: GNode): boolean =>
    (selection?.kind === 'hub' || selection?.kind === 'tag') &&
    n.kind === 'hub' &&
    !isSelectedHub(n);

  // the "you" node exists only in the closeness lens — ring guides circle it
  const youNode = layout.nodes.find((n) => n.kind === 'you');

  // wheel zoom around the pointer; non-passive so the page does not scroll.
  // keyed on `empty` so the listener attaches if the svg mounts later.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const { s: vs, ox, oy } = viewOf(rect);
      const px = (e.clientX - rect.left - ox) / vs;
      const py = (e.clientY - rect.top - oy) / vs;
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
    const { s: vs } = viewOf(rect);
    panRef.current = { ...pan, x: e.clientX, y: e.clientY, moved: true };
    setTransform((t) => ({ ...t, tx: t.tx + dx / vs, ty: t.ty + dy / vs }));
  };
  const endPan = () => {
    // cleared on the next tick so node click handlers can still see `moved`
    setTimeout(() => {
      panRef.current = null;
    }, 0);
  };
  const wasDrag = () => panRef.current?.moved === true;

  return (
    <div className="flex h-[260px] flex-col rounded-lg border border-slate-800 glass sm:h-[320px] xl:h-[360px]">
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
                    r={r * layout.scale}
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
              {mode === 'companies' ? 'company' : mode === 'cities' ? 'city' : 'tag'} · click to
              filter
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
