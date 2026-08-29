// Auth bridge: browser -> agents service. On success the session JWT is set
// as an httpOnly cookie — it never touches client-side JS. The browser posts
// {email, password} here over same-origin; the plaintext goes only to the
// agents service (which scrypt-hashes it) and is never stored or logged.

export const dynamic = 'force-dynamic';

const UPSTREAM = process.env.AGENTS_UPSTREAM ?? 'http://localhost:8080';
const SESSION_COOKIE = 'kw_session';
const SESSION_MAX_AGE = 30 * 24 * 3600; // mirror agents SESSION_TTL_DAYS

const ACTIONS = new Set(['login', 'signup', 'logout']);

function cookie(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

type Ctx = { params: Promise<{ action: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { action } = await ctx.params;
  if (!ACTIONS.has(action)) return new Response(null, { status: 404 });

  if (action === 'logout') {
    return Response.json(
      { ok: true },
      { headers: { 'Set-Cookie': cookie('', 0) } },
    );
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = process.env.AGENTS_API_TOKEN;
  if (token) headers['x-agents-token'] = token;

  const upstream = await fetch(`${UPSTREAM}/auth/${action}`, {
    method: 'POST',
    headers,
    body: await req.arrayBuffer(),
    cache: 'no-store',
  });

  const body = await upstream.text();
  if (!upstream.ok) {
    return new Response(body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  }

  const session = JSON.parse(body) as { token: string; uid: string; email: string };
  return Response.json(
    { uid: session.uid, email: session.email },
    { headers: { 'Set-Cookie': cookie(session.token, SESSION_MAX_AGE) } },
  );
}
