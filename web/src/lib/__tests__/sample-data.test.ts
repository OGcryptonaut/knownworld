// Contract check for the committed DEMO dataset (sample-data/result.json):
// openly fictional conversations with real public figures — it must stay
// parseable by the REAL ingest code and keep the demo guarantees intact.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_STORED_MESSAGES } from '../types';
import { processExport } from '../ingest/parse';

const OWNER_ID = 'user77000001';
// recency in closeness decays from real time; pin "now" near generation time
const NOW = Date.parse('2026-08-29T18:00:00');

function loadJson(name: string) {
  return JSON.parse(readFileSync(join(__dirname, `../../../../sample-data/${name}`), 'utf-8'));
}

describe('sample-data/result.json (demo dataset)', () => {
  const raw = loadJson('result.json');
  const knowledge = loadJson('demo-knowledge.json');
  const { myId, metas, stored } = processExport(raw.chats.list, NOW);
  const personal = metas.filter((m) => m.type === 'personal_chat');

  it('declares its fictional nature in the export itself', () => {
    expect(raw.about).toMatch(/fictional/i);
    expect(knowledge._note).toMatch(/fictional/i);
  });

  it('detects the owner via saved_messages', () => {
    expect(myId).toBe(OWNER_ID);
  });

  it('has exactly 15 personal chats, all with stored messages', () => {
    expect(personal).toHaveLength(15);
    for (const meta of personal) expect(meta.storedCount).toBeGreaterThan(0);
  });

  it('every personal chat has a knowledge-sidecar entry with real facts', () => {
    for (const meta of personal) {
      const entry = knowledge.people[String(meta.id)];
      expect(entry, `sidecar entry for ${meta.name}`).toBeDefined();
      expect(entry.name).toBe(meta.name);
      expect(entry.company).toBeTruthy();
      expect(typeof entry.lat).toBe('number');
      expect(typeof entry.lng).toBe('number');
      expect(entry.citations.length).toBeGreaterThan(0);
    }
  });

  it('at least 8 contacts point at companies with live-verified feeds', () => {
    const withFeed = Object.values(knowledge.people).filter(
      (p) => (p as { has_verified_feed: boolean }).has_verified_feed,
    );
    expect(withFeed.length).toBeGreaterThanOrEqual(8);
  });

  it('caps stored messages and resolves both sides of the dialogue', () => {
    const musk = metas.find((m) => m.id === 100000001)!;
    expect(musk.msgCount).toBeGreaterThan(MAX_STORED_MESSAGES);
    expect(musk.storedCount).toBe(MAX_STORED_MESSAGES);
    expect(musk.myCount).toBeGreaterThan(0);
    expect(musk.theirCount).toBeGreaterThan(0);
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
