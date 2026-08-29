'use client';

// Network graph panel — You at the center, companies as hubs, people linked
// to their company. Inferred affiliations stay visually distinct (dashed)
// from definite ones; the two are never merged into one edge style. Clicking
// a person node selects that person's table row below.

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { companyOf, type DbRow } from './shared';

const W = 900;
const H = 470;
const PAD = 40;
const TICKS = 300;

interface GNode extends SimulationNodeDatum {
  id: string;
  kind: 'you' | 'company' | 'person';
  label: string; // raw — person labels masked at render time
  r: number;
  tgId?: number;
}

interface GLink extends SimulationLinkDatum<GNode> {
  kind: 'affiliation' | 'company';
  inferred: boolean;
}

interface Layout {
  nodes: GNode[];
  links: GLink[];
}

function personRadius(closeness: number): number {
  return 4 + (Math.max(0, Math.min(100, closeness)) / 100) * 6;
}

function buildLayout(rows: DbRow[]): Layout {
  const nodes: GNode[] = [{ id: 'you', kind: 'you', label: 'You', r: 12, fx: 0, fy: 0 }];
  const links: GLink[] = [];
  const companyIds = new Map<string, string>();

  for (const row of rows) {
    const { name: company } = companyOf(row);
    if (company && !companyIds.has(company)) {
      const id = `c:${company}`;
      companyIds.set(company, id);
      nodes.push({ id, kind: 'company', label: company, r: 6 });
      links.push({ source: id, target: 'you', kind: 'company', inferred: false });
    }
  }

  const isolated = new Set<string>();
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
    const { name: company, inferred } = companyOf(row);
    if (company) {
      links.push({ source: id, target: companyIds.get(company)!, kind: 'affiliation', inferred });
    } else {
      isolated.add(id);
    }
  }

  const sim = forceSimulation<GNode>(nodes)
    .force(
      'link',
      forceLink<GNode, GLink>(links)
        .id((d) => d.id)
        .distance((l) => (l.kind === 'company' ? 120 : 40)),
    )
    .force('charge', forceManyBody<GNode>().strength(-90))
    .force('center', forceCenter<GNode>(0, 0))
    .force('collide', forceCollide<GNode>().radius((d) => d.r + 5))
    .force(
      'rim',
      forceRadial<GNode>(240).strength((d) => (isolated.has(d.id) ? 0.08 : 0)),
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
  onSelect,
}: {
  rows: DbRow[];
  onSelect: (tgId: number) => void;
}) {
  const { masked } = usePrivacy();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [transform, setTransform] = useState({ k: 1, tx: 0, ty: 0 });

  const layout = useMemo(() => buildLayout(rows), [rows]);
  const empty = rows.length === 0;

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

  return (
    <div className="flex h-[360px] flex-col rounded-lg border border-slate-800 bg-slate-900/40">
      <div className="flex items-center gap-3 border-b border-slate-800/80 px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Network graph
        </span>
        <span className="ml-auto text-[11px] text-slate-500">scroll to zoom</span>
      </div>

      {empty ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <p className="text-sm text-slate-400">No distilled people yet — run Refine first.</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 p-1">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid meet"
            className="h-full w-full"
            role="img"
            aria-label="Network graph"
          >
            <g transform={`translate(${transform.tx},${transform.ty}) scale(${transform.k})`}>
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
                    className={l.kind === 'company' ? 'stroke-slate-800' : 'stroke-slate-700'}
                    strokeWidth={l.kind === 'company' ? 1.25 : 1}
                  />
                );
              })}
              {layout.nodes.map((n) => (
                <g
                  key={n.id}
                  onMouseEnter={() => setHoverId(n.id)}
                  onMouseLeave={() => setHoverId(null)}
                  onClick={() => {
                    if (n.kind === 'person' && n.tgId !== undefined) onSelect(n.tgId);
                  }}
                  className={n.kind === 'person' ? 'cursor-pointer' : 'cursor-default'}
                >
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.r}
                    strokeWidth={1.5}
                    className={
                      n.kind === 'you'
                        ? 'fill-emerald-400 stroke-emerald-200'
                        : n.kind === 'company'
                          ? `fill-slate-600 ${hoverId === n.id ? 'stroke-slate-300' : 'stroke-transparent'}`
                          : `fill-emerald-500/70 ${hoverId === n.id ? 'stroke-emerald-200' : 'stroke-transparent'}`
                    }
                  />
                  {(n.kind === 'you' ||
                    n.kind === 'company' ||
                    (n.kind === 'person' && hoverId === n.id)) && (
                    <text
                      x={n.x}
                      y={(n.y ?? 0) - n.r - 4}
                      textAnchor="middle"
                      className={
                        n.kind === 'you'
                          ? 'fill-emerald-300 text-[11px] font-medium'
                          : n.kind === 'company'
                            ? 'fill-slate-300 text-[10px]'
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
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
          company
        </span>
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
      </div>
    </div>
  );
}
