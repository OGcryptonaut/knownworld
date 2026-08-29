// Knownworld dashboard — basic-auth gate.
//
// Production (Cloud Run): deploy.sh mounts Secret Manager secret
// 'dashboard-auth' as BASIC_AUTH_PASS, so every request must carry a matching
// `Authorization: Basic` header (user defaults to 'knownworld' via
// BASIC_AUTH_USER). Local dev: BASIC_AUTH_PASS is unset and every request
// passes through untouched.
//
// Edge-safe: only process.env + Web APIs (btoa), no Node built-ins.

import { NextRequest, NextResponse } from "next/server";

// Constant-time-ish string compare — no early exit on first mismatch.
function safeEqual(a: string, b: string): boolean {
  let diff = a.length === b.length ? 0 : 1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function middleware(request: NextRequest): NextResponse {
  const pass = process.env.BASIC_AUTH_PASS;
  if (!pass) {
    return NextResponse.next(); // gate disabled (local dev)
  }

  const user = process.env.BASIC_AUTH_USER || "knownworld";
  const expected = `Basic ${btoa(`${user}:${pass}`)}`;
  const provided = request.headers.get("authorization") ?? "";

  if (safeEqual(provided, expected)) {
    return NextResponse.next();
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="knownworld"' },
  });
}

export const config = {
  // Gate everything except Next's static assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
