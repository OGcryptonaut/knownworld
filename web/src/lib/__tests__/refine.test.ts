// Refine batching: candidate selection order, batch sizing, char capping.
// Pure helpers only — no IndexedDB, no network. Synthetic data.

import { describe, expect, it } from 'vitest';
import {
  MAX_CHAT_CHARS,
  REFINE_BATCH_SIZE,
  type ChatMeta,
  type NormalizedMessage,
} from '../types';
import {
  batchChats,
  buildChatPayload,
  capMessages,
  selectCandidates,
} from '../refine';

function makeMeta(overrides: Partial<ChatMeta> & { id: number }): ChatMeta {
  return {
    name: `Test Person ${overrides.id}`,
    type: 'personal_chat',
    msgCount: 10,
    myCount: 5,
    theirCount: 5,
    firstDate: '2026-01-01T10:00:00',
    lastDate: '2026-02-01T10:00:00',
    closeness: 50,
    storedCount: 10,
    ...overrides,
  };
}

function makeMessage(text: string, i: number): NormalizedMessage {
  return {
    fromMe: i % 2 === 0,
    date: new Date(Date.parse('2026-02-01T00:00:00Z') + i * 60_000).toISOString(),
    text,
  };
}

describe('selectCandidates', () => {
  it('keeps only personal chats with stored messages, closest first', () => {
    const metas: ChatMeta[] = [
      makeMeta({ id: 1, closeness: 50 }),
      makeMeta({ id: 2, closeness: 90, type: 'private_group' }),
      makeMeta({ id: 3, closeness: 80 }),
      makeMeta({ id: 4, closeness: 99, storedCount: 0 }),
      makeMeta({ id: 5, closeness: 70, type: 'saved_messages' }),
      makeMeta({ id: 6, closeness: 95 }),
    ];
    expect(selectCandidates(metas).map((m) => m.id)).toEqual([6, 3, 1]);
  });
});

describe('batchChats', () => {
  it('splits into REFINE_BATCH_SIZE batches, remainder last', () => {
    const items = Array.from({ length: 45 }, (_, i) => i);
    const batches = batchChats(items);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(REFINE_BATCH_SIZE);
    expect(batches[1]).toHaveLength(REFINE_BATCH_SIZE);
    expect(batches[2]).toHaveLength(45 - 2 * REFINE_BATCH_SIZE);
    expect(batches.flat()).toEqual(items); // order preserved
  });

  it('handles empty input', () => {
    expect(batchChats([])).toEqual([]);
  });
});

describe('capMessages', () => {
  it('keeps the most recent messages within MAX_CHAT_CHARS, in order', () => {
    const messages = [
      makeMessage('a'.repeat(5_000), 0),
      makeMessage('b'.repeat(5_000), 1),
      makeMessage('c'.repeat(5_000), 2),
      makeMessage('d'.repeat(5_000), 3),
    ];
    const capped = capMessages(messages); // cap 12_000 → last two fit (10k)
    expect(capped).toHaveLength(2);
    expect(capped[0].text[0]).toBe('c');
    expect(capped[1].text[0]).toBe('d');
    expect(Date.parse(capped[0].date)).toBeLessThan(Date.parse(capped[1].date));
    const total = capped.reduce((n, m) => n + m.text.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_CHAT_CHARS);
  });

  it('truncates a single oversized most-recent message instead of dropping it', () => {
    const messages = [
      makeMessage('old', 0),
      makeMessage('x'.repeat(MAX_CHAT_CHARS + 5_000), 1),
    ];
    const capped = capMessages(messages);
    expect(capped).toHaveLength(1);
    expect(capped[0].text).toHaveLength(MAX_CHAT_CHARS);
  });

  it('passes small chats through untouched', () => {
    const messages = [makeMessage('hi', 0), makeMessage('there', 1)];
    expect(capMessages(messages)).toEqual(messages);
  });
});

describe('buildChatPayload', () => {
  it('echoes code-computed closeness and maps message fields', () => {
    const meta = makeMeta({ id: 7, closeness: 83, myCount: 3, theirCount: 4 });
    const payload = buildChatPayload(meta, [
      makeMessage('hello', 0),
      makeMessage('yo', 1),
    ]);
    expect(payload.tg_id).toBe(7);
    expect(payload.closeness).toBe(83);
    expect(payload.my_msg_count).toBe(3);
    expect(payload.their_msg_count).toBe(4);
    expect(payload.last_message_iso).toBe(meta.lastDate);
    expect(payload.messages).toEqual([
      { from_me: true, date: payload.messages[0].date, text: 'hello' },
      { from_me: false, date: payload.messages[1].date, text: 'yo' },
    ]);
  });
});
