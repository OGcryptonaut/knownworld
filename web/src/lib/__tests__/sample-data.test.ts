// Contract check for the committed fictional sample dataset
// (sample-data/result.json): it must stay parseable by the REAL ingest code
// and keep every SAMPLE-DATA edge case intact. All people fictional.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_STORED_MESSAGES } from '../types';
import { processExport } from '../ingest/parse';

const OWNER_ID = 'user77000001';
// recency in closeness decays from real time; pin "now" near generation time
const NOW = Date.parse('2026-08-29T18:00:00');

function loadExport(): { chats: { list: unknown[] } } {
  const path = join(__dirname, '../../../../sample-data/result.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

describe('sample-data/result.json', () => {
  const raw = loadExport();
  const { myId, metas, stored } = processExport(raw.chats.list, NOW);
  const personal = metas.filter((m) => m.type === 'personal_chat');

  it('detects the owner via saved_messages', () => {
    expect(myId).toBe(OWNER_ID);
  });

  it('has exactly 15 personal chats, all with stored messages', () => {
    expect(personal).toHaveLength(15);
    for (const meta of personal) expect(meta.storedCount).toBeGreaterThan(0);
  });

  it('keeps the same-name collision (two distinct Tomas Kellers)', () => {
    const kellers = personal.filter((m) => m.name === 'Tomas Keller');
    expect(kellers).toHaveLength(2);
    expect(new Set(kellers.map((k) => k.id)).size).toBe(2);
  });

  it('has two nameless (handle-only) contacts', () => {
    expect(personal.filter((m) => m.name === '')).toHaveLength(2);
  });

  it('never states the hinted-only employer in Nazar’s thread', () => {
    const nazar = stored.find((s) => s.chatId === 161803398);
    expect(nazar).toBeDefined();
    const text = nazar!.messages.map((m) => m.text.toLowerCase()).join('\n');
    expect(text).not.toContain('polygon'); // hinted via zkEVM/POL/Amoy only
    expect(text).toContain('zkevm');
  });

  it('caps stored messages and resolves both sides of the dialogue', () => {
    const marta = metas.find((m) => m.id === 314159265)!;
    expect(marta.msgCount).toBeGreaterThan(MAX_STORED_MESSAGES);
    expect(marta.storedCount).toBe(MAX_STORED_MESSAGES);
    expect(marta.myCount).toBeGreaterThan(0);
    expect(marta.theirCount).toBeGreaterThan(0);
  });

  it('spreads closeness so ranking is meaningful (code-computed)', () => {
    const values = personal.map((m) => m.closeness);
    expect(Math.max(...values)).toBeGreaterThan(90);
    expect(Math.min(...values)).toBeLessThan(60);
  });

  it('keeps chronological order within every stored thread', () => {
    for (const s of stored) {
      const times = s.messages.map((m) => Date.parse(m.date));
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
      }
    }
  });
});
