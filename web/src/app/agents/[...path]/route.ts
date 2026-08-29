/**
 * Server-side proxy to the agents service. In production the dashboard calls
 * same-origin /agents/* and this handler forwards to AGENTS_UPSTREAM with the
 * bearer token from AGENTS_API_TOKEN — the token never reaches the browser.
 * Locally (no AGENTS_UPSTREAM) it forwards to http://localhost:8080 untokened.
 */
export const dynamic = 'force-dynamic';

const UPSTREAM = process.env.AGENTS_UPSTREAM ?? 'http://localhost:8080';

async function forward(req: Request, path: string[]): Promise<Response> {
  const url = new URL(req.url);
  const target = `${UPSTREAM}/${path.join('/')}${url.search}`;
  const headers: Record<string, string> = {};
  const ct = req.headers.get('content-type');
  if (ct) headers['content-type'] = ct;
  const token = process.env.AGENTS_API_TOKEN;
  if (token) headers['authorization'] = `Bearer ${token}`;
  const body =
    req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  const res = await fetch(target, { method: req.method, headers, body, cache: 'no-store' });
  return new Response(res.body, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  });
}

type Ctx = { params: Promise<{ path: string[] }> };
export async function GET(req: Request, ctx: Ctx) { return forward(req, (await ctx.params).path); }
export async function POST(req: Request, ctx: Ctx) { return forward(req, (await ctx.params).path); }
export async function DELETE(req: Request, ctx: Ctx) { return forward(req, (await ctx.params).path); }
