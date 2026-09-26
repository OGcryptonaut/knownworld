// boundary.ts is the single source the privacy page renders from. These
// tests keep it honest: four tiers in order, every item complete, every
// codeRef pointing at a file that exists, and the stored tier naming exactly
// the collections agents/app/inventory.py lists.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BOUNDARY_TIERS,
  DEPLOYMENT_NOTES,
  TIER_LABELS,
  TIER_ORDER,
  deploymentMode,
  deploymentNote,
  storedCollections,
  tier,
} from '../boundary';
import { MAX_CHAT_CHARS, REFINE_BATCH_SIZE } from '../types';

// web/src/lib/__tests__ -> repo root
const REPO_ROOT = resolve(__dirname, '../../../..');
const INVENTORY_PY = resolve(REPO_ROOT, 'agents/app/inventory.py');

function inventoryCollections(): string[] {
  const src = readFileSync(INVENTORY_PY, 'utf8');
  return [...src.matchAll(/collection="([A-Za-z_]+)"/g)].map((m) => m[1]);
}

describe('the four tiers', () => {
  it('are exactly the four, in display order, with the exact labels', () => {
    expect(BOUNDARY_TIERS.map((t) => t.id)).toEqual([...TIER_ORDER]);
    expect(TIER_ORDER).toEqual(['browser', 'transient', 'stored', 'never']);
    expect(BOUNDARY_TIERS.map((t) => t.label)).toEqual([
      'In this browser only',
      'Sent, not kept',
      'Stored in your account',
      'Never',
    ]);
    for (const t of BOUNDARY_TIERS) expect(t.label).toBe(TIER_LABELS[t.id]);
  });

  it('every item has item / where / why text', () => {
    for (const t of BOUNDARY_TIERS) {
      expect(t.summary.trim()).not.toBe('');
      expect(t.items.length).toBeGreaterThan(0);
      for (const i of t.items) {
        expect(i.item.trim(), `${t.id}: item`).not.toBe('');
        expect(i.where.trim(), `${t.id}/${i.item}: where`).not.toBe('');
        expect(i.why.trim(), `${t.id}/${i.item}: why`).not.toBe('');
      }
    }
  });

  it('tier() finds by id and rejects unknown ids', () => {
    expect(tier('never').id).toBe('never');
    expect(() => tier('nope' as never)).toThrow(/unknown boundary tier/);
  });
});

describe('proof links', () => {
  it('every codeRef points at a file in the repo', () => {
    for (const t of BOUNDARY_TIERS) {
      for (const i of t.items) {
        if (!i.codeRef) continue;
        const [path] = i.codeRef.split(' ');
        expect(existsSync(resolve(REPO_ROOT, path)), `${t.id}/${i.item}: ${i.codeRef}`).toBe(true);
      }
    }
  });

  it('the never and transient tiers cite code for every claim', () => {
    for (const id of ['transient', 'never'] as const) {
      for (const i of tier(id).items) expect(i.codeRef, `${id}/${i.item}`).toBeTruthy();
    }
  });
});

describe('the transient tier states the real batch limits', () => {
  it('quotes REFINE_BATCH_SIZE and MAX_CHAT_CHARS from lib/types', () => {
    const batches = tier('transient').items.find((i) => i.item === 'Distill batches');
    expect(batches).toBeDefined();
    expect(batches!.where).toContain(`${REFINE_BATCH_SIZE} chats`);
    expect(batches!.where).toContain(MAX_CHAT_CHARS.toLocaleString('en-US'));
    expect(batches!.where).toMatch(/proxy/);
    expect(batches!.where).toMatch(/Gemini/);
  });

  it('names the Ask egress: the question plus name/company pairs to grounded search', () => {
    const ask = tier('transient').items.find((i) => i.item === 'Your question in Ask');
    expect(ask).toBeDefined();
    expect(ask!.where).toMatch(/verbatim/);
    expect(ask!.where).toMatch(/up to 8 name\/company pairs/);
    expect(ask!.where).toMatch(/Google Search grounding/);
  });
});

describe('the stored tier mirrors agents/app/inventory.py', () => {
  it('names exactly the inventory collections, each once, each with a wipe switch', () => {
    const fromPy = inventoryCollections();
    expect(fromPy.length).toBeGreaterThan(0);
    const fromTs = storedCollections();
    expect([...fromTs].sort()).toEqual([...fromPy].sort());
    expect(new Set(fromTs).size).toBe(fromTs.length);
    for (const i of tier('stored').items) {
      expect(i.collections?.length, i.item).toBeGreaterThan(0);
      expect(i.wipedBy, i.item).toBeTruthy();
    }
  });

  it('the account is the only thing DELETE /data leaves that delete-account removes', () => {
    const byWipe = (w: string) =>
      tier('stored')
        .items.filter((i) => i.wipedBy === w)
        .flatMap((i) => [...(i.collections ?? [])]);
    expect(byWipe('delete-account').sort()).toEqual(['email_index', 'users']);
    expect(byWipe('never')).toEqual(['ats_slugs']);
    expect(byWipe('DELETE /data').sort()).toEqual(
      ['activity_log', 'enrichments', 'job_runs', 'jobs', 'people', 'pipeline', 'requests'],
    );
  });

  it('browser, transient and never items carry no collections', () => {
    for (const id of ['browser', 'transient', 'never'] as const) {
      for (const i of tier(id).items) {
        expect(i.collections, `${id}/${i.item}`).toBeUndefined();
        expect(i.wipedBy, `${id}/${i.item}`).toBeUndefined();
      }
    }
  });
});

describe('hosted vs self-deploy', () => {
  it('keys on NEXT_PUBLIC_DEPLOYMENT and defaults to the conservative claim', () => {
    expect(deploymentMode('self')).toBe('self');
    expect(deploymentMode(' SELF ')).toBe('self');
    expect(deploymentMode('hosted')).toBe('hosted');
    expect(deploymentMode(undefined)).toBe('hosted');
    expect(deploymentMode('')).toBe('hosted');
    expect(deploymentMode('anything-else')).toBe('hosted');
  });

  it('each mode has a note and the hosted one admits the operator could observe a batch', () => {
    expect(deploymentNote('hosted')).toBe(DEPLOYMENT_NOTES.hosted);
    expect(deploymentNote('self')).toBe(DEPLOYMENT_NOTES.self);
    expect(DEPLOYMENT_NOTES.hosted.body).toMatch(/operator/);
    expect(DEPLOYMENT_NOTES.hosted.body).toMatch(/self-deploy/);
    expect(DEPLOYMENT_NOTES.self.body).toMatch(/nobody else is in the loop/);
    for (const note of Object.values(DEPLOYMENT_NOTES)) {
      expect(note.title.trim()).not.toBe('');
      expect(note.body.trim()).not.toBe('');
    }
  });
});
