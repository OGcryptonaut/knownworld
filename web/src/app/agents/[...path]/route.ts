/**
 * Server-side proxy to the agents service (v2, session-aware). The dashboard
 * always calls same-origin /agents/*; this handler forwards to
 * AGENTS_UPSTREAM carrying:
 *   - X-Agents-Token: the service token (cloud only) — never in the browser
 *   - Authorization: Bearer <session JWT> from the httpOnly cookie — the
 *     agents service verifies it and scopes every store call to that user
 * Locally (no AGENTS_UPSTREAM/token) it forwards to http://localhost:8080.
 */
export const dynamic = 'force-dynamic';

const UPSTREAM = process.env.AGENTS_UPSTREAM ?? 'http://localhost:8080';
const SESSION_COOKIE = 'kw_session';

function sessionFrom(req: Request): string | null {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=') || null;
  }
  return null;
}

async function forward(req: Request, path: string[]): Promise<Response> {
  const url = new URL(req.url);
  const target = `${UPSTREAM}/${path.join('/')}${url.search}`;
  const headers: Record<string, string> = {};
  const ct = req.headers.get('content-type');
  if (ct) headers['content-type'] = ct;
  const token = process.env.AGENTS_API_TOKEN;
  if (token) headers['x-agents-token'] = token;
  const session = sessionFrom(req);
  if (session) headers['authorization'] = `Bearer ${session}`;
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
export async function PATCH(req: Request, ctx: Ctx) { return forward(req, (await ctx.params).path); }
export async function DELETE(req: Request, ctx: Ctx) { return forward(req, (await ctx.params).path); }
