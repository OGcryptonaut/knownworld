'use client';

// Snapshot renderer — shows exactly what the run produced. Rejected model
// output is surfaced WITH its validation reasons; errors are errors; nothing
// is ever invented to fill the gap.

import type { UserRequest } from '@/lib/types';
import { IntentChip, relTime, StatusChip } from './shared';
import { JobsResult } from './JobsResult';
import { PeopleResult } from './PeopleResult';

export function RequestResultView({ request }: { request: UserRequest }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="min-w-0 max-w-full break-words text-base font-semibold text-slate-100">
            {request.query}
          </h2>
          {request.intent && <IntentChip intent={request.intent} />}
          <StatusChip status={request.status} />
          <span className="ml-auto text-xs tabular-nums text-slate-500" title={request.created_at}>
            {relTime(request.created_at)}
          </span>
        </div>
        {request.note && (
          <>
            <p className="mt-2.5 text-xs uppercase tracking-wide text-slate-500">
              how the agent read it
            </p>
            <p className="mt-0.5 text-sm italic text-slate-400">{request.note}</p>
          </>
        )}
      </div>

      {request.status === 'rejected' && (
        <div className="rounded-lg border border-amber-800/70 bg-amber-950/30 p-5">
          <p className="text-sm text-amber-300">
            The model&apos;s output failed validation and was rejected:
          </p>
          {request.rejected_reasons.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-amber-200/90">
              {request.rejected_reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-amber-400/80">
            Nothing was stored from this run. Ask again.
          </p>
        </div>
      )}

      {request.status === 'error' && (
        <div className="rounded-lg border border-rose-900/70 bg-rose-950/30 p-5">
          <p className="text-sm text-rose-300">Request failed</p>
          <p className="mt-1 text-xs text-rose-200/80">{request.error ?? 'unknown error'}</p>
        </div>
      )}

      {request.status === 'running' && (
        <p className="px-1 text-sm text-slate-500">Still running. This view updates when it finishes.</p>
      )}

      {request.status === 'done' &&
        request.result &&
        (request.result.kind === 'jobs' ? (
          <JobsResult result={request.result} />
        ) : (
          <PeopleResult result={request.result} />
        ))}
    </div>
  );
}
