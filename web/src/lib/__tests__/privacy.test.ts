// The "Mask names" setting: a real per-device switch (default OFF, persisted
// in localStorage) plus the render-time mask functions. Invented names only.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PRIVACY_MODE_DEFAULT,
  PRIVACY_MODE_KEY,
  displayName,
  maskHandle,
  maskPersonName,
  privacyModeEnabled,
  setPrivacyMode,
  type PrivacyStorage,
} from '../privacy';

function memoryStorage(initial: Record<string, string> = {}): PrivacyStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

describe('privacy mode storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults OFF', () => {
    expect(PRIVACY_MODE_DEFAULT).toBe(false);
    expect(privacyModeEnabled(memoryStorage())).toBe(false);
    expect(privacyModeEnabled(null)).toBe(false);
  });

  it('reads the persisted value under PRIVACY_MODE_KEY', () => {
    expect(privacyModeEnabled(memoryStorage({ [PRIVACY_MODE_KEY]: '1' }))).toBe(true);
    expect(privacyModeEnabled(memoryStorage({ [PRIVACY_MODE_KEY]: '0' }))).toBe(false);
    expect(privacyModeEnabled(memoryStorage({ [PRIVACY_MODE_KEY]: 'garbage' }))).toBe(false);
  });

  it('setPrivacyMode round-trips through storage', () => {
    const storage = memoryStorage();
    setPrivacyMode(true, storage);
    expect(storage.data.get(PRIVACY_MODE_KEY)).toBe('1');
    expect(privacyModeEnabled(storage)).toBe(true);
    setPrivacyMode(false, storage);
    expect(storage.data.get(PRIVACY_MODE_KEY)).toBe('0');
    expect(privacyModeEnabled(storage)).toBe(false);
  });

  it('is OFF server-side (no window) and when storage throws', () => {
    expect(typeof window).toBe('undefined');
    expect(privacyModeEnabled()).toBe(false);
    const throwing: PrivacyStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(privacyModeEnabled(throwing)).toBe(false);
    expect(() => setPrivacyMode(true, throwing)).not.toThrow();
  });

  it('uses window.localStorage by default in a browser', () => {
    const storage = memoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    expect(privacyModeEnabled()).toBe(false);
    setPrivacyMode(true);
    expect(storage.data.get(PRIVACY_MODE_KEY)).toBe('1');
    expect(privacyModeEnabled()).toBe(true);
  });
});

describe('mask functions', () => {
  it('masks a full name to first name + last initial', () => {
    expect(maskPersonName('Testy McTestface')).toBe('Testy M.');
    expect(maskPersonName('Ada Byron Lovelace')).toBe('Ada Byron L.');
    expect(maskPersonName('  padded   name ')).toBe('Padded N.');
  });

  it('passes single names through and labels blanks', () => {
    expect(maskPersonName('Cher')).toBe('Cher');
    expect(maskPersonName('')).toBe('(unnamed)');
    expect(maskPersonName('   ')).toBe('(unnamed)');
  });

  it('masks handles to first and last character', () => {
    expect(maskHandle('@somehandle')).toBe('@s…e');
    expect(maskHandle('somehandle')).toBe('@s…e');
    expect(maskHandle('@ab')).toBe('@a…');
    expect(maskHandle('@')).toBe('@…');
    expect(maskPersonName('@somehandle')).toBe('@s…e');
  });

  it('displayName masks only when asked', () => {
    expect(displayName('Testy McTestface', false)).toBe('Testy McTestface');
    expect(displayName('Testy McTestface', true)).toBe('Testy M.');
  });
});
