// Privacy display mode — masking happens at RENDER time only; stored data is
// never modified. Defaults ON. Demo video + report screenshots: masking ON.

export const PRIVACY_MODE_KEY = 'kw-privacy-mask';

export function privacyModeEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const v = window.localStorage.getItem(PRIVACY_MODE_KEY);
    return v === null ? true : v === '1'; // default ON
  } catch {
    return true;
  }
}

export function setPrivacyMode(on: boolean): void {
  try {
    window.localStorage.setItem(PRIVACY_MODE_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
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
