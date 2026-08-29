// Closeness is computed IN CODE from message volume + recency.
// Product rule (SPEC v1 / CLAUDE.md): a model never scores closeness.
// volume: log-scaled so 500+ messages saturates; recency: exp decay, ~180d scale.

export function computeCloseness(
  msgCount: number,
  lastDateIso: string | null,
  now: number = Date.now(),
): number {
  const volume = Math.min(1, Math.log10(1 + Math.max(0, msgCount)) / Math.log10(501));
  let recency = 0;
  if (lastDateIso) {
    const t = Date.parse(lastDateIso);
    if (!Number.isNaN(t)) {
      const days = Math.max(0, (now - t) / 86_400_000);
      recency = Math.exp(-days / 180);
    }
  }
  return Math.round(100 * (0.6 * volume + 0.4 * recency));
}
