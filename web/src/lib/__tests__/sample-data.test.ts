// Contract check for the committed DEMO dataset (sample-data/result.json):
// wholly fictional people at real companies, invented conversations — it
// must stay parseable by the REAL ingest code and keep every demo guarantee
// the product relies on (bands, the namesake pair, the handle-only rows,
// the employer-mention rule, the live-feed cross-check, the public copy).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_STORED_MESSAGES } from '../types';
import { processExport } from '../ingest/parse';

const OWNER_ID = 'user77000001';
// recency in closeness decays from real time; pin "now" to generation time
// (the generator's --now default)
const NOW = Date.parse('2026-09-26T12:00:00');
const REPO = join(__dirname, '../../../..');

function loadJson(relPath: string) {
  return JSON.parse(readFileSync(join(REPO, relPath), 'utf-8'));
}

// same normalization the job scout keys ats-slugs.json by (lowercase,
// punctuation to spaces) — enough for the demo company names
function slugKey(company: string): string {
  return company.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

type SidecarEntry = {
  name: string;
  handle: string | null;
  company: string;
  company_mention: 'definite' | 'inferred';
  lat: number;
  lng: number;
  citations: { title: string; url: string }[];
  has_verified_feed: boolean;
  identified: boolean;
  evidence_employer: string | null;
  resolved_name: string | null;
  linkedin_url: string | null;
};

type ExpectedRow = {
  tg_id: number;
  name: string;
  company_definite: string | null;
  company_inferred: string | null;
};

describe('sample-data/result.json (demo dataset)', () => {
  const raw = loadJson('sample-data/result.json');
  const knowledge = loadJson('sample-data/demo-knowledge.json');
  const expected = loadJson('sample-data/expected-people.json');
  const slugs = loadJson('data/ats-slugs.json');
  const people = knowledge.people as Record<string, SidecarEntry>;
  const rows = expected.people as ExpectedRow[];
  const { myId, metas, stored } = processExport(raw.chats.list, NOW);
  const personal = metas.filter((m) => m.type === 'personal_chat');
  const chatText = new Map<number, string>();
  for (const chat of raw.chats.list) {
    if (chat.type !== 'personal_chat') continue;
    chatText.set(
      chat.id,
      (chat.messages as { text: string }[]).map((m) => m.text).join('\n').toLowerCase(),
    );
  }

  it('declares its fictional nature in every generated file', () => {
    expect(raw.about).toMatch(/fictional/i);
    expect(knowledge._note).toMatch(/fictional/i);
    expect(expected._note).toMatch(/fictional/i);
  });

  it('detects the owner via saved_messages', () => {
    expect(myId).toBe(OWNER_ID);
    expect(metas.filter((m) => m.type === 'saved_messages')).toHaveLength(1);
  });

  it('has exactly 17 personal chats, all with stored messages', () => {
    expect(personal).toHaveLength(17);
    for (const meta of personal) expect(meta.storedCount).toBeGreaterThan(0);
  });

  it('carries two handle-only contacts (blank name) that the sidecar tracks by handle', () => {
    const nameless = personal.filter((m) => m.name === '');
    expect(nameless).toHaveLength(2);
    for (const meta of nameless) {
      const entry = people[String(meta.id)];
      expect(entry.name).toBe('');
      expect(entry.handle).toMatch(/^@\w+$/);
      expect(chatText.get(meta.id)).toContain(entry.handle!.toLowerCase());
    }
    // one resolves to a public name, the other stays honestly unidentified
    const resolved = nameless.filter((m) => people[String(m.id)].resolved_name);
    const unresolved = nameless.filter((m) => !people[String(m.id)].identified);
    expect(resolved).toHaveLength(1);
    expect(unresolved).toHaveLength(1);
    expect(resolved[0].id).not.toBe(unresolved[0].id);
  });

  it('carries a same-name pair at different companies, one of which research mismatches', () => {
    const counts = new Map<string, number[]>();
    for (const meta of personal) {
      if (!meta.name) continue;
      counts.set(meta.name, [...(counts.get(meta.name) ?? []), meta.id]);
    }
    const pairs = [...counts.entries()].filter(([, ids]) => ids.length > 1);
    expect(pairs).toHaveLength(1);
    const [, ids] = pairs[0];
    expect(ids).toHaveLength(2);
    const [a, b] = ids.map((id) => people[String(id)]);
    expect(a.company).not.toBe(b.company);
    // exactly one of the two is resolved to the other's employer by "research"
    const mismatched = [a, b].filter((e) => e.evidence_employer !== e.company);
    expect(mismatched).toHaveLength(1);
    expect([a.company, b.company]).toContain(mismatched[0].evidence_employer);
  });

  it('every personal chat has a sidecar entry and a golden expected row', () => {
    for (const meta of personal) {
      const entry = people[String(meta.id)];
      expect(entry, `sidecar entry for chat ${meta.id}`).toBeDefined();
      expect(entry.name).toBe(meta.name);
      expect(entry.company).toBeTruthy();
      expect(typeof entry.lat).toBe('number');
      expect(typeof entry.lng).toBe('number');
      expect(entry.linkedin_url).toBeNull(); // fictional people: nothing to link
      for (const c of entry.citations) expect(c.url).toMatch(/^https:\/\//);
      const row = rows.find((r) => r.tg_id === meta.id);
      expect(row, `expected-people row for chat ${meta.id}`).toBeDefined();
      expect(row!.name).toBe(meta.name);
    }
    expect(rows).toHaveLength(personal.length);
  });

  it('has_verified_feed agrees with data/ats-slugs.json for every company', () => {
    let withFeed = 0;
    for (const entry of Object.values(people)) {
      const verified = slugKey(entry.company) in slugs;
      expect(entry.has_verified_feed, `${entry.company} feed flag`).toBe(verified);
      if (verified) withFeed += 1;
    }
    expect(withFeed).toBeGreaterThanOrEqual(12);
    // the honest no-feed path is exercised by at least one contact
    expect(Object.values(people).some((e) => !e.has_verified_feed)).toBe(true);
  });

  it('names the employer in the chats exactly when the golden row says definite', () => {
    let inferred = 0;
    for (const row of rows) {
      const text = chatText.get(row.tg_id)!;
      const company = row.company_definite ?? row.company_inferred;
      expect(company, `company for ${row.tg_id}`).toBeTruthy();
      // the sidecar and the golden row must agree on how the employer surfaced
      const entry = people[String(row.tg_id)];
      expect(entry.company).toBe(company);
      expect(entry.company_mention).toBe(row.company_definite ? 'definite' : 'inferred');
      const stem = company!.toLowerCase().split(' ')[0];
      if (row.company_definite) {
        expect(row.company_inferred).toBeNull();
        expect(text, `${row.tg_id} should name ${company}`).toContain(stem);
      } else {
        expect(text, `${row.tg_id} must only hint at ${company}`).not.toContain(stem);
        inferred += 1;
      }
    }
    expect(inferred).toBeGreaterThanOrEqual(3);
    expect(inferred).toBeLessThanOrEqual(4);
  });

  it('caps stored messages and resolves both sides of the dialogue', () => {
    const longest = personal.reduce((a, b) => (b.msgCount > a.msgCount ? b : a));
    expect(longest.msgCount).toBeGreaterThan(MAX_STORED_MESSAGES);
    expect(longest.storedCount).toBe(MAX_STORED_MESSAGES);
    expect(longest.myCount).toBeGreaterThan(0);
    expect(longest.theirCount).toBeGreaterThan(0);
  });

  it('spreads closeness across all four bands (code-computed)', () => {
    const values = personal.map((m) => m.closeness);
    const inBand = (lo: number, hi: number) => values.filter((v) => v >= lo && v <= hi).length;
    expect(inBand(90, 100)).toBeGreaterThanOrEqual(2); // C1
    expect(inBand(70, 89)).toBeGreaterThanOrEqual(2); // C2
    expect(inBand(50, 69)).toBeGreaterThanOrEqual(2); // C3
    expect(inBand(0, 49)).toBeGreaterThanOrEqual(2); // C4, quiet for months
  });

  it('keeps chronological order within every stored thread', () => {
    for (const s of stored) {
      const times = s.messages.map((m) => Date.parse(m.date));
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
      }
    }
  });

  it('ships the same bytes to the browser as web/public/demo-corpus.json', () => {
    const source = readFileSync(join(REPO, 'sample-data/result.json'));
    const served = readFileSync(join(REPO, 'web/public/demo-corpus.json'));
    expect(served.equals(source)).toBe(true);
  });
});
