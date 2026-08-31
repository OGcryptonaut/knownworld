// Module Web Worker: streams the raw Telegram export (878 MB — larger than
// V8's max string length, so whole-file JSON.parse is impossible) through a
// streaming JSON parser, chat by chat. Memory stays flat: keepStack:false
// drops emitted chats from the parser's internal structure.
//
// Privacy boundary: everything here runs in the browser. Parsed data goes to
// IndexedDB only.

import { JSONParser } from '@streamparser/json';
import type { IngestProgress, IngestSummary } from '../lib/types';
import { clearRefineRunState, putChatsBatch, setIngestSummary } from '../lib/db';
import {
  detectMyId,
  finalizeChat,
  processChat,
  type ProcessedChat,
} from '../lib/ingest/parse';

interface IngestRequest {
  file: File;
}

export type IngestWorkerMessage =
  | IngestProgress
  | { type: 'done'; summary: IngestSummary };

const PROGRESS_EVERY_CHATS = 100;
const PROGRESS_EVERY_BYTES = 4 * 1024 * 1024; // ~4 MB
const STORE_BATCH_SIZE = 100; // chats per IndexedDB transaction

const workerScope = self as unknown as {
  postMessage: (message: IngestWorkerMessage) => void;
  onmessage: ((ev: MessageEvent<IngestRequest>) => void) | null;
};

function post(message: IngestWorkerMessage): void {
  workerScope.postMessage(message);
}

async function run(file: File): Promise<void> {
  const bytesTotal = file.size;
  let bytesRead = 0;
  let messagesSeen = 0;
  const chats: ProcessedChat[] = [];

  const progress = (phase: IngestProgress['phase'], error?: string): void => {
    post({
      phase,
      bytesRead,
      bytesTotal,
      chatsSeen: chats.length,
      messagesSeen,
      ...(error !== undefined ? { error } : {}),
    });
  };

  try {
    let lastChatsPosted = 0;
    let lastBytesPosted = 0;
    let sniffed = false;

    // First-bytes sniff so a wrong file fails with a USEFUL error code the
    // upload step can explain (Telegram exports HTML by default; people also
    // drop the whole zip). Codes are mapped to copy in UploadStep.
    const sniff = (chunk: Uint8Array): void => {
      let i = 0;
      // skip UTF-8 BOM + whitespace
      if (chunk.length >= 3 && chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf) i = 3;
      while (i < chunk.length && (chunk[i] === 0x20 || chunk[i] === 0x09 || chunk[i] === 0x0a || chunk[i] === 0x0d)) i += 1;
      if (i >= chunk.length) return; // all whitespace — sniff the next chunk
      sniffed = true;
      const b = chunk[i];
      if (b === 0x3c) throw new Error('not-json-html');
      if (b === 0x50 && chunk[i + 1] === 0x4b) throw new Error('not-json-zip');
      if (b !== 0x7b && b !== 0x5b) throw new Error('not-json');
    };

    const parser = new JSONParser({
      paths: ['$.chats.list.*'],
      keepStack: false, // do not retain emitted chats in the parser stack
    });
    parser.onValue = (info) => {
      const chat = processChat(info.value);
      if (chat) {
        chats.push(chat);
        messagesSeen += chat.msgCount;
      }
      if (chats.length - lastChatsPosted >= PROGRESS_EVERY_CHATS) {
        lastChatsPosted = chats.length;
        lastBytesPosted = bytesRead;
        progress('parsing');
      }
    };

    progress('parsing');
    const reader = file.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (!sniffed) sniff(value);
      try {
        parser.write(value);
      } catch {
        // the stream is JSON but broken partway — a cut-off or edited export
        throw new Error('corrupt-json');
      }
      if (bytesRead - lastBytesPosted >= PROGRESS_EVERY_BYTES) {
        lastBytesPosted = bytesRead;
        lastChatsPosted = chats.length;
        progress('parsing');
      }
    }
    try {
      parser.end();
    } catch {
      // A truncated tail after all chats parsed should not lose the ingest.
    }

    if (chats.length === 0) {
      // valid JSON, but not the shape of a full Telegram export
      throw new Error('no-chats');
    }

    // Full pass done — detect "me" (no personal_information block in this
    // export format), then resolve fromMe and write in batches.
    const myId = detectMyId(chats);
    const now = Date.now();
    progress('storing');
    try {
      for (let i = 0; i < chats.length; i += STORE_BATCH_SIZE) {
        const slice = chats.slice(i, i + STORE_BATCH_SIZE);
        const finalized = slice.map((c) => finalizeChat(c, myId, now));
        await putChatsBatch(
          finalized.map((f) => f.meta),
          finalized.map((f) => f.stored),
        );
        progress('storing');
      }
    } catch (e) {
      const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
      if (msg.toLowerCase().includes('quota')) throw new Error('quota');
      throw e;
    }

    const summary: IngestSummary = {
      fileName: file.name,
      fileSize: file.size,
      ingestedAt: new Date().toISOString(),
      totalChats: chats.length,
      totalMessages: messagesSeen,
      personalChats: chats.filter((c) => c.type === 'personal_chat').length,
      detectedMyId: myId,
      storedMessages: chats.reduce((s, c) => s + c.kept.length, 0),
    };
    await setIngestSummary(summary);
    // the batching is recomputed from the new data — stale refine-run state
    // would silently skip different chats on resume
    await clearRefineRunState();

    progress('done');
    post({ type: 'done', summary });
  } catch (err) {
    progress('error', err instanceof Error ? err.message : String(err));
  }
}

workerScope.onmessage = (ev: MessageEvent<IngestRequest>) => {
  void run(ev.data.file);
};
