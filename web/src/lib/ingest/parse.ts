// Pure normalization + me-detection logic for the Telegram export ingest.
// The web worker (src/workers/ingest.worker.ts) is a thin streaming shell
// around these functions so they stay unit-testable.
//
// Privacy: this code runs ONLY in the browser (worker context). Raw export
// content never leaves the client.

import {
  MAX_STORED_MESSAGES,
  type ChatMeta,
  type StoredChatMessages,
} from '../types';
import { computeCloseness } from '../closeness';

/** A kept message before fromMe resolution (needs the full-pass me-detection). */
export interface KeptMessage {
  fromId: string | null;
  date: string;
  text: string;
}

/** Per-chat accumulation produced by a single streaming pass. */
export interface ProcessedChat {
  id: number;
  name: string;
  type: string;
  /** All entries with type === 'message' (including ones not kept). */
  msgCount: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Message counts per from_id across ALL message-type entries. */
  fromCounts: Record<string, number>;
  /** Last MAX_STORED_MESSAGES text-bearing messages, chronological order. */
  kept: KeptMessage[];
}

/**
 * Telegram exports encode text as a plain string OR an array whose items are
 * strings and `{type, text}` entity objects. Flatten to one plain string.
 * Malformed input flattens to '' — never throws.
 */
export function flattenText(text: unknown): string {
  if (typeof text === 'string') return text;
  if (Array.isArray(text)) {
    let out = '';
    for (const part of text) {
      if (typeof part === 'string') {
        out += part;
      } else if (part && typeof part === 'object') {
        const t = (part as { text?: unknown }).text;
        if (typeof t === 'string') out += t;
        else if (Array.isArray(t)) out += flattenText(t);
      }
    }
    return out;
  }
  return '';
}

function normalizeFromId(fromId: unknown): string | null {
  if (typeof fromId === 'string' && fromId.length > 0) return fromId;
  if (typeof fromId === 'number' && Number.isFinite(fromId)) return String(fromId);
  return null;
}

/**
 * Normalize one raw chat object from `$.chats.list.*`.
 * Returns null for hopeless entries (non-object, missing numeric id).
 * Malformed message entries are skipped, never thrown on.
 */
export function processChat(raw: unknown): ProcessedChat | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const chat = raw as Record<string, unknown>;
  const id = chat.id;
  if (typeof id !== 'number' || !Number.isFinite(id)) return null;

  const type = typeof chat.type === 'string' ? chat.type : 'unknown';
  const name = typeof chat.name === 'string' ? chat.name : '';

  const out: ProcessedChat = {
    id,
    name,
    type,
    msgCount: 0,
    firstDate: null,
    lastDate: null,
    fromCounts: {},
    kept: [],
  };

  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  let firstTs = Number.POSITIVE_INFINITY;
  let lastTs = Number.NEGATIVE_INFINITY;

  for (const entry of messages) {
    try {
      if (!entry || typeof entry !== 'object') continue;
      const m = entry as Record<string, unknown>;
      if (m.type !== 'message') continue;
      out.msgCount += 1;

      const date = typeof m.date === 'string' ? m.date : null;
      if (date) {
        const ts = Date.parse(date);
        if (!Number.isNaN(ts)) {
          if (ts < firstTs) {
            firstTs = ts;
            out.firstDate = date;
          }
          if (ts > lastTs) {
            lastTs = ts;
            out.lastDate = date;
          }
        }
      }

      const fromId = normalizeFromId(m.from_id);
      if (fromId) out.fromCounts[fromId] = (out.fromCounts[fromId] ?? 0) + 1;

      const text = flattenText(m.text);
      if (text.length === 0 || !date) continue;

      out.kept.push({ fromId, date, text });
      if (out.kept.length > MAX_STORED_MESSAGES) out.kept.shift(); // keep the LAST N
    } catch {
      // malformed entry — skip and continue
    }
  }

  return out;
}

function maxCountKey(counts: Record<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [key, count] of Object.entries(counts)) {
    if (count > bestCount || (count === bestCount && best !== null && key < best)) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Detect the export owner's from_id. This export format carries NO
 * personal_information block, so:
 *  - primary: the dominant from_id inside the type === 'saved_messages' chat
 *    (only the owner writes there);
 *  - fallback: the from_id participating in the greatest number of DISTINCT
 *    personal_chat chats (the owner appears in nearly all of them; any other
 *    person appears in ~1). Ties break by total message volume, then
 *    lexicographically for determinism.
 */
export function detectMyId(chats: ProcessedChat[]): string | null {
  const saved = chats.find((c) => c.type === 'saved_messages');
  if (saved) {
    const fromSaved = maxCountKey(saved.fromCounts);
    if (fromSaved) return fromSaved;
  }

  const distinctChats: Record<string, number> = {};
  const totalMsgs: Record<string, number> = {};
  for (const chat of chats) {
    if (chat.type !== 'personal_chat') continue;
    for (const [fromId, count] of Object.entries(chat.fromCounts)) {
      distinctChats[fromId] = (distinctChats[fromId] ?? 0) + 1;
      totalMsgs[fromId] = (totalMsgs[fromId] ?? 0) + count;
    }
  }

  let best: string | null = null;
  for (const fromId of Object.keys(distinctChats)) {
    if (best === null) {
      best = fromId;
      continue;
    }
    const d = distinctChats[fromId] - distinctChats[best];
    if (d > 0) best = fromId;
    else if (d === 0) {
      const t = (totalMsgs[fromId] ?? 0) - (totalMsgs[best] ?? 0);
      if (t > 0 || (t === 0 && fromId < best)) best = fromId;
    }
  }
  return best;
}

/**
 * Resolve fromMe / myCount / theirCount, compute closeness (in CODE — never
 * by a model), and produce the rows written to IndexedDB.
 */
export function finalizeChat(
  chat: ProcessedChat,
  myId: string | null,
  now: number = Date.now(),
): { meta: ChatMeta; stored: StoredChatMessages } {
  const myCount = myId !== null ? (chat.fromCounts[myId] ?? 0) : 0;
  const meta: ChatMeta = {
    id: chat.id,
    name: chat.name,
    type: chat.type,
    msgCount: chat.msgCount,
    myCount,
    theirCount: chat.msgCount - myCount,
    firstDate: chat.firstDate,
    lastDate: chat.lastDate,
    closeness: computeCloseness(chat.msgCount, chat.lastDate, now),
    storedCount: chat.kept.length,
  };
  const stored: StoredChatMessages = {
    chatId: chat.id,
    messages: chat.kept.map((k) => ({
      fromMe: myId !== null && k.fromId === myId,
      date: k.date,
      text: k.text,
    })),
  };
  return { meta, stored };
}

/** Convenience for tests: run the full non-streaming pipeline over a chat list. */
export function processExport(
  rawChats: unknown[],
  now: number = Date.now(),
): {
  myId: string | null;
  metas: ChatMeta[];
  stored: StoredChatMessages[];
  totalMessages: number;
} {
  const chats: ProcessedChat[] = [];
  for (const raw of rawChats) {
    const chat = processChat(raw);
    if (chat) chats.push(chat);
  }
  const myId = detectMyId(chats);
  const metas: ChatMeta[] = [];
  const stored: StoredChatMessages[] = [];
  let totalMessages = 0;
  for (const chat of chats) {
    const { meta, stored: s } = finalizeChat(chat, myId, now);
    metas.push(meta);
    stored.push(s);
    totalMessages += chat.msgCount;
  }
  return { myId, metas, stored, totalMessages };
}
