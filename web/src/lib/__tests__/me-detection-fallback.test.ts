// Me-detection fallback: exports without a saved_messages chat resolve "me"
// as the from_id participating in the most DISTINCT personal chats.
// Synthetic ids only.

import { describe, expect, it } from 'vitest';
import { detectMyId, processChat, type ProcessedChat } from '../ingest/parse';

const ME = 'user1000';

function personalChat(
  id: number,
  otherId: string,
  otherName: string,
): unknown {
  return {
    id,
    name: otherName,
    type: 'personal_chat',
    messages: [
      {
        id: id * 10 + 1,
        type: 'message',
        date: '2026-01-01T10:00:00',
        from_id: otherId,
        text: 'hello',
      },
      {
        id: id * 10 + 2,
        type: 'message',
        date: '2026-01-01T10:01:00',
        from_id: ME,
        text: 'hey',
      },
    ],
  };
}

function process(raws: unknown[]): ProcessedChat[] {
  return raws
    .map((r) => processChat(r))
    .filter((c): c is ProcessedChat => c !== null);
}

describe('detectMyId fallback (no saved_messages chat)', () => {
  it('picks the from_id present in the most distinct personal chats', () => {
    const chats = process([
      personalChat(1, 'user2000', 'Test Person A'),
      personalChat(2, 'user3000', 'Test Person B'),
      personalChat(3, 'user4000', 'Test Person C'),
      // group chats are ignored by the fallback
      {
        id: 4,
        name: 'Test Group',
        type: 'private_group',
        messages: [
          {
            id: 99,
            type: 'message',
            date: '2026-01-02T10:00:00',
            from_id: 'user2000',
            text: 'group msg',
          },
        ],
      },
    ]);
    expect(detectMyId(chats)).toBe(ME);
  });

  it('prefers saved_messages when present, even over fallback counts', () => {
    const chats = process([
      personalChat(1, 'user2000', 'Test Person A'),
      personalChat(2, 'user3000', 'Test Person B'),
      {
        id: 5,
        type: 'saved_messages',
        messages: [
          {
            id: 50,
            type: 'message',
            date: '2026-01-03T10:00:00',
            from_id: 'user7777',
            text: 'a note',
          },
        ],
      },
    ]);
    expect(detectMyId(chats)).toBe('user7777');
  });

  it('returns null when there is nothing to go on', () => {
    expect(detectMyId([])).toBeNull();
    const groupOnly = process([
      {
        id: 6,
        name: 'Test Group',
        type: 'private_group',
        messages: [],
      },
    ]);
    expect(detectMyId(groupOnly)).toBeNull();
  });
});
