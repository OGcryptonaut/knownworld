// Dev-only corpus loader: streams the local Telegram export so the ingest
// path is scriptable in verification. Hard-gated to NODE_ENV=development AND
// an explicit DEV_EXPORT_PATH — 404 otherwise, so this can never serve data
// in a deployed build. The file itself lives in gitignored data-local/.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

export const dynamic = 'force-dynamic';

function devExportPath(): string | null {
  if (process.env.NODE_ENV !== 'development') return null;
  return process.env.DEV_EXPORT_PATH || null;
}

export async function GET(): Promise<Response> {
  const path = devExportPath();
  if (!path) return new Response(null, { status: 404 });

  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return new Response(null, { status: 404 });
  }

  const stream = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream;
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(size),
    },
  });
}

export async function HEAD(): Promise<Response> {
  const path = devExportPath();
  if (!path) return new Response(null, { status: 404 });
  try {
    const { size } = await stat(path);
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(size),
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
