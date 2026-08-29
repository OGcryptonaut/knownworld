// Module Web Worker: streams the raw Telegram export (878 MB — larger than
// V8's max string length, so whole-file JSON.parse is impossible) through a
// streaming JSON parser, chat by chat. Memory stays flat: keepStack:false
// drops emitted chats from the parser's internal structure.
//
// Privacy boundary: everything here runs in the browser. Parsed data goes to
// IndexedDB only.

import { JSONParser } from '@streamparser/json';
import type { IngestProgress, IngestSummary } from '../lib/types';
import { putChatsBatch, setIngestSummary } from '../lib/db';
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
      parser.write(value);
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

    // Full pass done — detect "me" (no personal_information block in this
    // export format), then resolve fromMe and write in batches.
    const myId = detectMyId(chats);
    const now = Date.now();
    progress('storing');
    for (let i = 0; i < chats.length; i += STORE_BATCH_SIZE) {
      const slice = chats.slice(i, i + STORE_BATCH_SIZE);
      const finalized = slice.map((c) => finalizeChat(c, myId, now));
      await putChatsBatch(
        finalized.map((f) => f.meta),
        finalized.map((f) => f.stored),
      );
      progress('storing');
    }

    const summary: IngestSummary = {
      fileName: file.name,
      fileSize: file.size,
      ingestedAt: new Date().toISOString(),
      totalChats: chats.length,
      totalMessages: messagesSeen,
      personalChats: chats.filter((c) => c.type === 'personal_chat').length,
      detectedMyId: myId,
    };
    await setIngestSummary(summary);

    progress('done');
    post({ type: 'done', summary });
  } catch (err) {
    progress('error', err instanceof Error ? err.message : String(err));
  }
}

workerScope.onmessage = (ev: MessageEvent<IngestRequest>) => {
  void run(ev.data.file);
};
