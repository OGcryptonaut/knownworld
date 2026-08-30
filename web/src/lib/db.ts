// IndexedDB wrapper — the ONLY persistence for raw-derived data. The raw
// Telegram export lives here (browser-side) and never reaches a server.
// Importable from both window and worker contexts (no window/document use).

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  ChatMeta,
  IngestSummary,
  RefineRunState,
  StoredChatMessages,
} from './types';

const DB_NAME = 'knownworld';
const DB_VERSION = 1;

const META_INGEST_KEY = 'ingest';
const META_REFINE_RUN_KEY = 'refineRun';

interface KnownworldSchema extends DBSchema {
  chats: { key: number; value: ChatMeta };
  messages: { key: number; value: StoredChatMessages };
  meta: { key: string; value: IngestSummary | RefineRunState };
}

let dbPromise: Promise<IDBPDatabase<KnownworldSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<KnownworldSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<KnownworldSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('chats')) {
          db.createObjectStore('chats', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('messages')) {
          db.createObjectStore('messages', { keyPath: 'chatId' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
        }
      },
    });
  }
  return dbPromise;
}

/** Write one ingest batch (metas + their stored messages) in one transaction. */
export async function putChatsBatch(
  metas: ChatMeta[],
  messages: StoredChatMessages[],
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['chats', 'messages'], 'readwrite');
  const chatStore = tx.objectStore('chats');
  const messageStore = tx.objectStore('messages');
  for (const meta of metas) void chatStore.put(meta);
  for (const stored of messages) void messageStore.put(stored);
  await tx.done;
}

export async function getAllChatMetas(): Promise<ChatMeta[]> {
  const db = await getDb();
  return db.getAll('chats');
}

export async function getChatMeta(chatId: number): Promise<ChatMeta | undefined> {
  const db = await getDb();
  return db.get('chats', chatId);
}

export async function getChatMessages(
  chatId: number,
): Promise<StoredChatMessages | undefined> {
  const db = await getDb();
  return db.get('messages', chatId);
}

export async function getIngestSummary(): Promise<IngestSummary | undefined> {
  const db = await getDb();
  return (await db.get('meta', META_INGEST_KEY)) as IngestSummary | undefined;
}

export async function setIngestSummary(summary: IngestSummary): Promise<void> {
  const db = await getDb();
  await db.put('meta', summary, META_INGEST_KEY);
}

export async function getRefineRunState(): Promise<RefineRunState | undefined> {
  const db = await getDb();
  return (await db.get('meta', META_REFINE_RUN_KEY)) as RefineRunState | undefined;
}

export async function setRefineRunState(state: RefineRunState): Promise<void> {
  const db = await getDb();
  await db.put('meta', state, META_REFINE_RUN_KEY);
}

/** Delete everything — the privacy screen's "delete all local data" switch. */
export async function clearAll(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['chats', 'messages', 'meta'], 'readwrite');
  void tx.objectStore('chats').clear();
  void tx.objectStore('messages').clear();
  void tx.objectStore('meta').clear();
  await tx.done;
}
