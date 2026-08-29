// 0..100 closeness — computed in code from volume+recency, never by a model.

export function ClosenessBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-7 text-right tabular-nums text-slate-300">{v}</span>
      <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-slate-800">
        <span
          className="block h-full rounded-full bg-emerald-500"
          style={{ width: `${v}%` }}
        />
      </span>
    </span>
  );
}
