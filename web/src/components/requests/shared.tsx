// Requests UI vocabulary — status chip (done emerald / rejected amber /
// error rose / running pulse), intent chip, relative time.

import type { UserRequest } from '@/lib/types';

const base =
  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] leading-4 whitespace-nowrap';

export function StatusChip({ status }: { status: UserRequest['status'] }) {
  switch (status) {
    case 'done':
      return (
        <span className={`${base} border-emerald-800 bg-emerald-950/50 text-emerald-300`}>
          done
        </span>
      );
    case 'rejected':
      return (
        <span className={`${base} border-amber-700 bg-amber-950/50 text-amber-300`}>
          rejected
        </span>
      );
    case 'error':
      return (
        <span className={`${base} border-rose-800 bg-rose-950/50 text-rose-300`}>error</span>
      );
    default:
      return (
        <span className={`${base} animate-pulse border-sky-800 bg-sky-950/50 text-sky-300`}>
          running
        </span>
      );
  }
}

export function IntentChip({ intent }: { intent: 'jobs' | 'people' | 'intro' }) {
  return (
    <span className={`${base} border-slate-700 bg-slate-900/60 text-slate-300`}>
      {intent === 'jobs' ? 'job postings' : intent === 'intro' ? 'intro draft' : 'people'}
    </span>
  );
}

export function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
