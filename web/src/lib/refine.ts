// Client pump driving the refine agent. Batches are TRANSIENT server-side:
// batch in → distilled rows out → batch discarded. Only this module decides
// what leaves the browser, and it sends at most REFINE_BATCH_SIZE chats per
// request, each capped to MAX_CHAT_CHARS of most-recent text.
// Closeness is code-computed at ingest and only ECHOED here — never asked of
// a model. NO DOM/UI code in this file.

import {
  MAX_CHAT_CHARS,
  REFINE_BATCH_SIZE,
  type ChatMeta,
  type NormalizedMessage,
  type RefineBatchRequest,
  type RefineBatchResponse,
  type RefineChatPayload,
  type RefineRunState,
} from './types';
import {
  getAllChatMetas,
  getChatMessages,
  getRefineRunState,
  setRefineRunState,
} from './db';

export type RefineEvent =
  | { type: 'start'; totalBatches: number; resumedBatches: number }
  | {
      type: 'batch';
      response: RefineBatchResponse;
      progress: {
        completedBatches: number;
        totalBatches: number;
        peopleFound: number;
      };
    }
  | { type: 'retry'; batchIndex: number; attempt: number; delayMs: number; error: string }
  /** one batch gave up after retries — the run keeps going without it */
  | { type: 'batch-failed'; batchIndex: number; error: string }
  | { type: 'done'; state: RefineRunState }
  | { type: 'error'; error: string; state: RefineRunState };

/** HTTP failure carrying the status + the server's detail text, when any. */
export class BatchHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 401/403 sink every batch the same way — stop the run instead of skipping. */
function isFatalForRun(err: unknown): boolean {
  return err instanceof BatchHttpError && (err.status === 401 || err.status === 403);
}

/** Retrying only helps when the failure can change: network, 408/429, 5xx. */
function isRetryable(err: unknown): boolean {
  if (!(err instanceof BatchHttpError)) return true; // network-level failure
  return err.status === 408 || err.status === 429 || err.status >= 500;
}

export interface StartRefineRunOptions {
  agentsUrl: string;
  onEvent: (e: RefineEvent) => void;
  signal?: AbortSignal;
}

const CONCURRENCY = 2;
const RETRY_DELAYS_MS = [1_000, 4_000, 10_000]; // 3 retries, exponential-ish

// ---- Pure helpers (unit-tested directly) ----------------------------------

/** Candidate chats: personal chats with stored text, closest first. */
export function selectCandidates(metas: ChatMeta[]): ChatMeta[] {
  return metas
    .filter((m) => m.type === 'personal_chat' && m.storedCount > 0)
    .sort((a, b) => b.closeness - a.closeness);
}

export function batchChats<T>(items: T[], size: number = REFINE_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * Cap a chat's messages so total text length <= maxChars, keeping the MOST
 * RECENT messages (chronological order preserved). If the single most recent
 * message alone exceeds the cap, it is truncated rather than dropped.
 */
export function capMessages(
  messages: NormalizedMessage[],
  maxChars: number = MAX_CHAT_CHARS,
): NormalizedMessage[] {
  const kept: NormalizedMessage[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (total + m.text.length > maxChars) {
      if (kept.length === 0) {
        kept.push({ ...m, text: m.text.slice(0, maxChars) });
      }
      break;
    }
    total += m.text.length;
    kept.push(m);
  }
  return kept.reverse();
}

export function buildChatPayload(
  meta: ChatMeta,
  messages: NormalizedMessage[],
): RefineChatPayload {
  return {
    tg_id: meta.id,
    name: meta.name,
    my_msg_count: meta.myCount,
    their_msg_count: meta.theirCount,
    last_message_iso: meta.lastDate,
    closeness: meta.closeness, // code-computed; echoed through, never model-derived
    messages: capMessages(messages).map((m) => ({
      from_me: m.fromMe,
      date: m.date,
      text: m.text,
    })),
  };
}

// ---- Network --------------------------------------------------------------

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(): Error {
  return new DOMException('refine run aborted', 'AbortError');
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/** Pull the server's `detail` out of an error body, if it sent one. */
async function readErrorDetail(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object') {
      const detail = (body as { detail?: unknown }).detail;
      if (typeof detail === 'string' && detail.trim() !== '') return detail.slice(0, 300);
      if (detail !== undefined) return JSON.stringify(detail).slice(0, 300);
    }
  } catch {
    /* not JSON — fall through */
  }
  return null;
}

async function postBatchWithRetry(
  url: string,
  request: RefineBatchRequest,
  signal?: AbortSignal,
  onRetry?: (attempt: number, delayMs: number, error: string) => void,
): Promise<RefineBatchResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal,
      });
      if (!res.ok) {
        const detail = await readErrorDetail(res);
        throw new BatchHttpError(
          res.status,
          `HTTP ${res.status}${detail ? `: ${detail}` : ''}`,
        );
      }
      return (await res.json()) as RefineBatchResponse;
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) throw err;
      if (!isRetryable(err)) throw err;
      if (attempt >= RETRY_DELAYS_MS.length) throw err;
      const delayMs = RETRY_DELAYS_MS[attempt];
      onRetry?.(attempt + 1, delayMs, err instanceof Error ? err.message : String(err));
      await sleep(delayMs, signal);
    }
  }
}

// ---- Run driver -----------------------------------------------------------

/**
 * Drive a full refine run: select candidates, batch, POST with concurrency 2
 * and per-batch retry, persist RefineRunState after every completed batch so
 * a reload resumes, pause on abort. Resolves with the final persisted state;
 * failures surface as an 'error' event, not a rejection.
 */
export async function startRefineRun(
  opts: StartRefineRunOptions,
): Promise<RefineRunState> {
  const { agentsUrl, onEvent, signal } = opts;

  const metas = await getAllChatMetas();
  const candidates = selectCandidates(metas);
  const batches = batchChats(candidates);
  const totalBatches = batches.length;

  // Resume an incomplete run over the same batching; otherwise start fresh.
  const previous = await getRefineRunState();
  let state: RefineRunState;
  if (
    previous &&
    previous.status !== 'done' &&
    previous.totalBatches === totalBatches &&
    previous.completedBatches.length < totalBatches
  ) {
    state = { ...previous, status: 'running' };
  } else {
    state = {
      runId: crypto.randomUUID(),
      totalBatches,
      completedBatches: [],
      peopleFound: 0,
      startedAt: new Date().toISOString(),
      status: 'running',
    };
  }
  await setRefineRunState(state);
  onEvent({
    type: 'start',
    totalBatches,
    resumedBatches: state.completedBatches.length,
  });

  const completed = new Set(state.completedBatches);
  const pending = batches
    .map((_, index) => index)
    .filter((index) => !completed.has(index));

  const url = `${agentsUrl.replace(/\/$/, '')}/refine/batch`;
  let cursor = 0;
  let aborted = false;
  let fatal: string | null = null;
  const failedBatches: { index: number; error: string }[] = [];

  const runBatch = async (index: number): Promise<void> => {
    const chats: RefineChatPayload[] = [];
    for (const meta of batches[index]) {
      const stored = await getChatMessages(meta.id);
      chats.push(buildChatPayload(meta, stored?.messages ?? []));
    }
    const request: RefineBatchRequest = {
      run_id: state.runId,
      batch_index: index,
      batch_count: totalBatches,
      chats,
    };
    const response = await postBatchWithRetry(url, request, signal, (attempt, delayMs, error) =>
      onEvent({ type: 'retry', batchIndex: index, attempt, delayMs, error }),
    );

    state.completedBatches = [...state.completedBatches, index].sort((a, b) => a - b);
    state.peopleFound += response.people.length;
    await setRefineRunState({ ...state });
    onEvent({
      type: 'batch',
      response,
      progress: {
        completedBatches: state.completedBatches.length,
        totalBatches,
        peopleFound: state.peopleFound,
      },
    });
  };

  const worker = async (): Promise<void> => {
    while (!aborted && fatal === null) {
      if (signal?.aborted) {
        aborted = true;
        return;
      }
      if (cursor >= pending.length) return;
      const index = pending[cursor++];
      try {
        await runBatch(index);
      } catch (err) {
        if (isAbortError(err) || signal?.aborted) {
          aborted = true;
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        if (isFatalForRun(err)) {
          // auth is gone — every remaining batch would fail the same way
          fatal = message;
          return;
        }
        // One bad batch must not sink the run. Skip it and keep going;
        // Retry later re-runs exactly the batches that never completed.
        failedBatches.push({ index, error: message });
        onEvent({ type: 'batch-failed', batchIndex: index, error: message });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()),
  );

  if (aborted) {
    state.status = 'paused';
    await setRefineRunState({ ...state });
    onEvent({ type: 'done', state });
    return state;
  }
  if (fatal !== null) {
    state.status = 'error';
    await setRefineRunState({ ...state });
    onEvent({ type: 'error', error: fatal, state });
    return state;
  }
  if (failedBatches.length > 0) {
    // partial run: everything that could finish did; status stays non-done
    // so the next Retry resumes over just the failed batches
    state.status = 'error';
    await setRefineRunState({ ...state });
    onEvent({
      type: 'error',
      error: `${failedBatches.length} of ${totalBatches} batches failed`,
      state,
    });
    return state;
  }
  state.status = 'done';
  await setRefineRunState({ ...state });
  onEvent({ type: 'done', state });
  return state;
}
