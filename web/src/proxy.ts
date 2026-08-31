// Knownworld v2 — session gate (Next 16 'proxy' convention, ex-middleware).
//
// Auth is enforced where the data lives: every /agents/* API call carries the
// session JWT and the agents service verifies it per request. This middleware
// is the UX layer on top: no session cookie -> redirect pages to /login and
// 401 the API proxy, so unauthenticated visitors never see empty shells.
//
// Edge-safe: only Web APIs, no Node built-ins.

import { NextRequest, NextResponse } from "next/server";

export const SESSION_COOKIE = "kw_session";

const PUBLIC_PATHS = new Set(["/login", "/signup"]);

export default function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // a signed-in user landing on the auth pages (post-Google redirect,
  // accidental reload) belongs in the app, not at the form
  if (PUBLIC_PATHS.has(pathname) && request.cookies.get(SESSION_COOKIE)?.value) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg"
  ) {
    return NextResponse.next();
  }

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (session) return NextResponse.next();

  if (pathname.startsWith("/agents/") || pathname.startsWith("/api/")) {
    return NextResponse.json({ detail: "not signed in" }, { status: 401 });
  }

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(login);
}

export const config = {
  // everything except Next internals and static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
