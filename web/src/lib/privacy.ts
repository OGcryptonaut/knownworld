// Privacy display mode ("Mask names") — a REAL per-device setting.
//
// Masking happens at RENDER time only ("Sahil Massey" -> "Sahil M.",
// "@somehandle" -> "@s…e"); stored data is never modified. Default OFF. The
// choice persists in this browser's localStorage only — it never reaches the
// server, so each device decides for itself. PrivacyProvider broadcasts it;
// every table/map/graph/log reads `masked` from there and calls displayName.
//
// NO DOM/UI code beyond localStorage in this file.

export const PRIVACY_MODE_KEY = 'kw-privacy-mask';
export const PRIVACY_MODE_DEFAULT = false;

/** The slice of Storage we use — injectable so tests need no window. */
export type PrivacyStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): PrivacyStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // storage access can throw (privacy modes, sandboxed frames)
    return null;
  }
}

/** The persisted mode: ON only when this browser stored '1'. Unset,
 *  unreadable, or server-side -> the default (OFF). */
export function privacyModeEnabled(
  storage: PrivacyStorage | null = defaultStorage(),
): boolean {
  try {
    const raw = storage?.getItem(PRIVACY_MODE_KEY);
    return raw == null ? PRIVACY_MODE_DEFAULT : raw === '1';
  } catch {
    return PRIVACY_MODE_DEFAULT;
  }
}

export function setPrivacyMode(
  on: boolean,
  storage: PrivacyStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(PRIVACY_MODE_KEY, on ? '1' : '0');
  } catch {
    /* ignore — the in-memory value still drives this session */
  }
}

/** "Sahil Massey" -> "Sahil M." ; single names pass through; handles masked. */
export function maskPersonName(name: string): string {
  const n = (name ?? '').trim();
  if (!n) return '(unnamed)';
  if (n.startsWith('@')) return maskHandle(n);
  const parts = n.split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  const lastInitial = [...last][0] ?? '';
  return `${parts.slice(0, -1).join(' ').charAt(0).toUpperCase()}${parts
    .slice(0, -1)
    .join(' ')
    .slice(1)} ${lastInitial.toUpperCase()}.`;
}

/** "@somehandle" -> "@s…e" */
export function maskHandle(handle: string): string {
  const h = handle.replace(/^@/, '');
  if (h.length <= 2) return `@${h[0] ?? ''}…`;
  return `@${h[0]}…${h[h.length - 1]}`;
}

export function displayName(name: string, masked: boolean): string {
  return masked ? maskPersonName(name) : name;
}
