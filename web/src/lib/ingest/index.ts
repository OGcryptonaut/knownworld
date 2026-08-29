// Window-side entry for the browser ingest: spawns the streaming worker and
// exposes a Promise-based API. The raw export file never leaves the browser.

import type { IngestProgress, IngestSummary } from '../types';
import type { IngestWorkerMessage } from '../../workers/ingest.worker';

export function ingestFile(
  file: File,
  onProgress: (p: IngestProgress) => void,
): Promise<IngestSummary> {
  return new Promise<IngestSummary>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(
        new URL('../../workers/ingest.worker.ts', import.meta.url),
        { type: 'module' },
      );
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const finish = (): void => worker.terminate();

    worker.onmessage = (ev: MessageEvent<IngestWorkerMessage>) => {
      const msg = ev.data;
      if ('type' in msg && msg.type === 'done') {
        finish();
        resolve(msg.summary);
        return;
      }
      const progress = msg as IngestProgress;
      onProgress(progress);
      if (progress.phase === 'error') {
        finish();
        reject(new Error(progress.error ?? 'ingest failed'));
      }
    };
    worker.onerror = (ev: ErrorEvent) => {
      finish();
      reject(new Error(ev.message || 'ingest worker error'));
    };

    worker.postMessage({ file });
  });
}

/**
 * Dev-only path: pull the corpus from the local dev server so verification is
 * scriptable. response.blob() is disk-backed in Chromium for large responses,
 * so wrapping it in a File keeps memory flat — it then flows through the
 * exact same streaming worker path as a user-picked file.
 */
export async function ingestFromDevServer(
  onProgress: (p: IngestProgress) => void,
): Promise<IngestSummary> {
  const res = await fetch('/api/dev/export');
  if (!res.ok) {
    throw new Error(`dev export unavailable: HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const file = new File([blob], 'result.json', { type: 'application/json' });
  return ingestFile(file, onProgress);
}
