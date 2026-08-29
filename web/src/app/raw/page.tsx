'use client';

// The D0 gate page — every chat from the export, rendered straight from the
// browser's IndexedDB. Manual windowed rendering keeps 2,800+ rows smooth.

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMeta } from '@/lib/types';
import { getAllChatMetas } from '@/lib/db';
import { displayName } from '@/lib/privacy';
import { usePrivacy } from '@/components/PrivacyProvider';
import { LocalBadge } from '@/components/Badges';
import { ClosenessBar } from '@/components/ClosenessBar';

const ROW_H = 36; // px, fixed — required for windowing math
const OVERSCAN = 10;

type TypeFilter = 'all' | 'personal' | 'groups' | 'other';
type SortKey = 'name' | 'type' | 'messages' | 'mine' | 'first' | 'last' | 'closeness';

const FILTERS: { key: TypeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'personal', label: 'Personal' },
  { key: 'groups', label: 'Groups' },
  { key: 'other', label: 'Other' },
];

const GRID = 'minmax(200px,1.6fr) 100px 90px 110px 96px 96px 150px';

function typeLabel(t: string): string {
  switch (t) {
    case 'personal_chat':
      return 'personal';
    case 'private_group':
      return 'group';
    case 'private_supergroup':
      return 'supergroup';
    case 'saved_messages':
      return 'saved';
    case 'bot_chat':
      return 'bot';
    default:
      return t;
  }
}

function matchesFilter(meta: ChatMeta, f: TypeFilter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'personal':
      return meta.type === 'personal_chat';
    case 'groups':
      return meta.type === 'private_group' || meta.type === 'private_supergroup';
    case 'other':
      return (
        meta.type !== 'personal_chat' &&
        meta.type !== 'private_group' &&
        meta.type !== 'private_supergroup'
      );
  }
}

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

function HeaderCell({
  label,
  k,
  right,
  sortKey,
  sortDesc,
  onToggle,
}: {
  label: string;
  k: SortKey;
  right?: boolean;
  sortKey: SortKey;
  sortDesc: boolean;
  onToggle: (k: SortKey) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(k)}
      className={`flex items-center gap-1 px-2 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 hover:text-slate-300 ${
        right ? 'justify-end text-right' : 'text-left'
      }`}
    >
      {label}
      {sortKey === k && <span className="text-emerald-400">{sortDesc ? '▼' : '▲'}</span>}
    </button>
  );
}

export default function RawTablePage() {
  const { masked } = usePrivacy();
  const [metas, setMetas] = useState<ChatMeta[] | null>(null);
  const [filter, setFilter] = useState<TypeFilter>('personal');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('closeness');
  const [sortDesc, setSortDesc] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);

  useEffect(() => {
    getAllChatMetas()
      .then(setMetas)
      .catch(() => setMetas([]));
  }, []);

  useEffect(() => {
    const measure = () => {
      if (scrollRef.current) setViewportH(scrollRef.current.clientHeight);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [metas]);

  const onScroll = useCallback(() => {
    if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
  }, []);

  const rows = useMemo(() => {
    if (!metas) return [];
    const q = query.trim().toLowerCase();
    const filtered = metas.filter(
      (m) => matchesFilter(m, filter) && (q === '' || m.name.toLowerCase().includes(q)),
    );
    const dir = sortDesc ? -1 : 1;
    const sorted = [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return dir * a.name.localeCompare(b.name);
        case 'type':
          return dir * a.type.localeCompare(b.type);
        case 'messages':
          return dir * (a.msgCount - b.msgCount);
        case 'mine':
          return dir * (a.myCount - b.myCount);
        case 'first':
          return dir * (a.firstDate ?? '').localeCompare(b.firstDate ?? '');
        case 'last':
          return dir * (a.lastDate ?? '').localeCompare(b.lastDate ?? '');
        case 'closeness':
          return dir * (a.closeness - b.closeness);
      }
    });
    return sorted;
  }, [metas, filter, query, sortKey, sortDesc]);

  const stats = useMemo(() => {
    if (!metas) return null;
    return {
      chats: metas.length,
      personal: metas.filter((m) => m.type === 'personal_chat').length,
      messages: metas.reduce((acc, m) => acc + m.msgCount, 0),
    };
  }, [metas]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(key !== 'name' && key !== 'type'); // numeric/date default desc
    }
    scrollRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  };

  // windowing math
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const visible = Math.ceil(viewportH / ROW_H) + OVERSCAN * 2;
  const end = Math.min(rows.length, start + visible);
  const topPad = start * ROW_H;
  const bottomPad = (rows.length - end) * ROW_H;

  if (metas !== null && metas.length === 0) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center">
        <p className="text-sm text-slate-300">No chats in this browser yet.</p>
        <p className="mt-1 text-xs text-slate-500">
          Import your Telegram export first — it never leaves this tab.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Go to onboarding
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-semibold tracking-tight">Raw Table</h1>
        {stats && (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <span>
              <span className="tabular-nums text-slate-200">{stats.chats.toLocaleString()}</span>{' '}
              chats ·{' '}
              <span className="tabular-nums text-slate-200">{stats.personal.toLocaleString()}</span>{' '}
              personal ·{' '}
              <span className="tabular-nums text-slate-200">{stats.messages.toLocaleString()}</span>{' '}
              messages
            </span>
            <span className="text-slate-600">—</span>
            <span>rendered from your browser’s IndexedDB · nothing uploaded</span>
            <LocalBadge />
          </p>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => {
              setFilter(f.key);
              scrollRef.current?.scrollTo({ top: 0 });
              setScrollTop(0);
            }}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              filter === f.key
                ? 'border-emerald-700 bg-emerald-950/60 text-emerald-300'
                : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            scrollRef.current?.scrollTo({ top: 0 });
            setScrollTop(0);
          }}
          placeholder="Search names…"
          className="ml-auto w-56 rounded-md border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
        />
        <span className="text-xs tabular-nums text-slate-500">
          {rows.length.toLocaleString()} shown
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto rounded-lg border border-slate-800">
        <div className="flex h-full min-w-[900px] flex-col">
          <div
            className="grid shrink-0 border-b border-slate-800 bg-slate-900/60"
            style={{ gridTemplateColumns: GRID }}
          >
            <HeaderCell label="Name" k="name" sortKey={sortKey} sortDesc={sortDesc} onToggle={toggleSort} />
            <HeaderCell label="Type" k="type" sortKey={sortKey} sortDesc={sortDesc} onToggle={toggleSort} />
            <HeaderCell label="Messages" k="messages" right sortKey={sortKey} sortDesc={sortDesc} onToggle={toggleSort} />
            <HeaderCell label="Mine / Theirs" k="mine" right sortKey={sortKey} sortDesc={sortDesc} onToggle={toggleSort} />
            <HeaderCell label="First" k="first" sortKey={sortKey} sortDesc={sortDesc} onToggle={toggleSort} />
            <HeaderCell label="Last" k="last" sortKey={sortKey} sortDesc={sortDesc} onToggle={toggleSort} />
            <HeaderCell label="Closeness" k="closeness" sortKey={sortKey} sortDesc={sortDesc} onToggle={toggleSort} />
          </div>

          <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
            {metas === null ? (
              <p className="px-3 py-6 text-sm text-slate-500">Loading from IndexedDB…</p>
            ) : (
              <>
                <div style={{ height: topPad }} />
                {rows.slice(start, end).map((m) => (
                  <div
                    key={m.id}
                    className="grid items-center border-b border-slate-900 text-sm hover:bg-slate-900/50"
                    style={{ gridTemplateColumns: GRID, height: ROW_H }}
                  >
                    <div className="truncate px-2 text-slate-100">
                      {displayName(m.name, masked)}
                    </div>
                    <div className="px-2 text-xs text-slate-400">{typeLabel(m.type)}</div>
                    <div className="px-2 text-right tabular-nums text-slate-200">
                      {m.msgCount.toLocaleString()}
                    </div>
                    <div className="px-2 text-right tabular-nums text-slate-400">
                      {m.myCount.toLocaleString()}
                      <span className="text-slate-600"> / </span>
                      {m.theirCount.toLocaleString()}
                    </div>
                    <div className="px-2 text-xs tabular-nums text-slate-400">
                      {fmtDate(m.firstDate)}
                    </div>
                    <div className="px-2 text-xs tabular-nums text-slate-400">
                      {fmtDate(m.lastDate)}
                    </div>
                    <div className="px-2">
                      <ClosenessBar value={m.closeness} />
                    </div>
                  </div>
                ))}
                <div style={{ height: bottomPad }} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
