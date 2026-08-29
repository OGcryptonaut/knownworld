// Parser normalization + me-detection over a SYNTHETIC export fixture.
// All names/ids invented — no real data in tests, ever.

import { describe, expect, it } from 'vitest';
import { MAX_STORED_MESSAGES } from '../types';
import { flattenText, processChat, processExport } from '../ingest/parse';

const ME = 'user1000';
const PERSON_A = 'user2000';
const PERSON_B = 'user3000';

let nextId = 1;
function msg(
  from_id: string,
  date: string,
  text: unknown,
): Record<string, unknown> {
  return { id: nextId++, type: 'message', date, from: 'x', from_id, text };
}
function service(date: string): Record<string, unknown> {
  return { id: nextId++, type: 'service', date, action: 'phone_call' };
}

function bigChatMessages(count: number): Record<string, unknown>[] {
  const base = Date.parse('2026-02-01T00:00:00');
  return Array.from({ length: count }, (_, i) =>
    msg(
      i % 2 === 0 ? ME : PERSON_B,
      new Date(base + i * 60_000).toISOString(),
      `m${i}`,
    ),
  );
}

function fixtureChats(): unknown[] {
  return [
    // saved_messages has no name and only the owner writes there
    {
      id: 1,
      type: 'saved_messages',
      messages: [
        msg(ME, '2026-01-10T09:00:00', 'note one'),
        msg(ME, '2026-01-11T09:00:00', 'note two'),
      ],
    },
    {
      id: 2,
      name: 'Test Person A',
      type: 'personal_chat',
      messages: [
        msg(PERSON_A, '2026-01-01T10:00:00', 'hi there'),
        msg(ME, '2026-01-02T10:00:00', [
          'reply ',
          { type: 'link', text: 'https://example.test' },
        ]),
        service('2026-01-03T10:00:00'), // service entry: not a message
        msg(PERSON_A, '2026-01-04T10:00:00', ''), // empty text: counted, not kept
        msg(ME, '2026-01-05T10:00:00', [{ type: 'bold', text: 'ok' }, ' then']),
      ],
    },
    {
      id: 3,
      name: 'Test Person B',
      type: 'personal_chat',
      messages: bigChatMessages(320), // exceeds MAX_STORED_MESSAGES
    },
    {
      id: 4,
      name: 'Test Group',
      type: 'private_group',
      messages: [
        msg(ME, '2026-01-06T10:00:00', 'group hello'),
        msg(PERSON_A, '2026-01-07T10:00:00', 'group reply'),
      ],
    },
    // malformed: no id — skipped entirely
    { name: 'No Id Chat', type: 'personal_chat', messages: [] },
    // malformed message entries — never throw, just skipped
    {
      id: 5,
      name: 'Test Person C',
      type: 'personal_chat',
      messages: [
        null,
        42,
        'nope',
        { type: 'message' }, // no date, no text
        msg(PERSON_A, '2026-01-08T10:00:00', 'still works'),
      ],
    },
  ];
}

describe('flattenText', () => {
  it('passes plain strings through', () => {
    expect(flattenText('hello')).toBe('hello');
  });

  it('flattens mixed arrays of strings and entity objects', () => {
    expect(
      flattenText(['a ', { type: 'link', text: 'b' }, ' c']),
    ).toBe('a b c');
  });

  it('handles nested entity text arrays and garbage', () => {
    expect(flattenText([{ text: ['x', { text: 'y' }] }])).toBe('xy');
    expect(flattenText(undefined)).toBe('');
    expect(flattenText(123)).toBe('');
    expect(flattenText({ not: 'text' })).toBe('');
  });
});

describe('processChat', () => {
  it('returns null for chats without a numeric id', () => {
    expect(processChat({ name: 'No Id Chat', type: 'personal_chat' })).toBeNull();
    expect(processChat(null)).toBeNull();
    expect(processChat('junk')).toBeNull();
  });

  it('counts all message-type entries but keeps only non-empty text', () => {
    const chat = processChat(fixtureChats()[1]);
    expect(chat).not.toBeNull();
    expect(chat!.msgCount).toBe(4); // service entry excluded, empty text included
    expect(chat!.kept.map((k) => k.text)).toEqual([
      'hi there',
      'reply https://example.test',
      'ok then',
    ]);
    expect(chat!.firstDate).toBe('2026-01-01T10:00:00');
    expect(chat!.lastDate).toBe('2026-01-05T10:00:00');
  });

  it('never throws on malformed message entries', () => {
    const chat = processChat(fixtureChats()[5]);
    expect(chat).not.toBeNull();
    expect(chat!.kept.map((k) => k.text)).toEqual(['still works']);
  });
});

describe('processExport (full pipeline over the synthetic fixture)', () => {
  const now = Date.parse('2026-03-01T00:00:00Z');
  const result = processExport(fixtureChats(), now);

  it('detects "me" from the saved_messages chat', () => {
    expect(result.myId).toBe(ME);
  });

  it('produces metas for every well-formed chat and skips the id-less one', () => {
    expect(result.metas.map((m) => m.id).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    // chat 5: the bare {type:'message'} entry still counts toward msgCount
    expect(result.totalMessages).toBe(2 + 4 + 320 + 2 + 2);
  });

  it('resolves fromMe and my/their counts via the detected id', () => {
    const meta = result.metas.find((m) => m.id === 2)!;
    expect(meta.myCount).toBe(2);
    expect(meta.theirCount).toBe(2);
    const stored = result.stored.find((s) => s.chatId === 2)!;
    expect(stored.messages.map((m) => m.fromMe)).toEqual([false, true, true]);
  });

  it('caps stored messages to the LAST MAX_STORED_MESSAGES', () => {
    const meta = result.metas.find((m) => m.id === 3)!;
    expect(meta.msgCount).toBe(320);
    expect(meta.storedCount).toBe(MAX_STORED_MESSAGES);
    const stored = result.stored.find((s) => s.chatId === 3)!;
    expect(stored.messages).toHaveLength(MAX_STORED_MESSAGES);
    // 320 messages, indices 0..319 — the last 300 start at index 20
    expect(stored.messages[0].text).toBe('m20');
    expect(stored.messages[stored.messages.length - 1].text).toBe('m319');
    expect(stored.messages[0].fromMe).toBe(true); // even index → ME
    expect(stored.messages[1].fromMe).toBe(false);
  });

  it('computes closeness in code for every chat, in range 0..100', () => {
    for (const meta of result.metas) {
      expect(typeof meta.closeness).toBe('number');
      expect(meta.closeness).toBeGreaterThanOrEqual(0);
      expect(meta.closeness).toBeLessThanOrEqual(100);
    }
    const big = result.metas.find((m) => m.id === 3)!;
    const small = result.metas.find((m) => m.id === 5)!;
    expect(big.closeness).toBeGreaterThan(small.closeness);
  });
});
