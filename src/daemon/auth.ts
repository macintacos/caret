// The daemon's token gate: policy only — decide whether a request carries the token,
// trade a `?token=` login for a cookie, and build the rejection.

import { timingSafeEqual } from "node:crypto";

/** 400 days, Chrome's cap on a cookie's lifetime. */
const COOKIE_MAX_AGE_S = 34_560_000;

const REJECTION_PAGE =
  "<!doctype html><title>caret</title><p>This caret daemon requires sign-in. " +
  "Open caret's login link to continue.</p>";

/** The challenge on every gate 401; the client keys DaemonAuthError on it. */
export const AUTH_CHALLENGE = 'Bearer realm="caret"';

/** The auth cookie's name; the port keeps two daemons on one hostname apart. */
function authCookieName(port: number): string {
  return `caret-auth-${port}`;
}

function matches(candidate: string | null | undefined, token: string): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

function reject(url: URL, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("WWW-Authenticate", AUTH_CHALLENGE);
  if (url.pathname.startsWith("/api/")) {
    return Response.json({ error: "caret daemon token required" }, { status: 401, headers });
  }
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(REJECTION_PAGE, { status: 401, headers });
}

function login(
  url: URL,
  presented: string,
  auth: { token: string; port: number; secure: boolean },
): Response {
  const noReferrer = { "Referrer-Policy": "no-referrer" };
  if (!matches(presented, auth.token)) return reject(url, noReferrer);
  const params = new URLSearchParams(url.search);
  params.delete("token");
  const query = params.size > 0 ? `?${params}` : "";
  // Collapse leading slashes: `//evil.com/` as a relative Location is protocol-relative.
  const location = `/${url.pathname.replace(/^\/+/, "")}${query}`;
  const cookie = new Bun.Cookie(authCookieName(auth.port), auth.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: auth.secure,
    path: "/",
    maxAge: COOKIE_MAX_AGE_S,
  });
  return new Response(null, {
    status: 303,
    headers: { ...noReferrer, Location: location, "Set-Cookie": cookie.serialize() },
  });
}

/** null to let the request through; otherwise the login redirect or the 401 to send.
 * `secure`: the request arrived over HTTPS (a login's cookie is then `Secure`). */
export function authGate(
  req: Request,
  url: URL,
  auth: { token: string; port: number; secure: boolean },
): Response | null {
  const presented = url.searchParams.get("token");
  if (req.method === "GET" && presented !== null) return login(url, presented, auth);
  const cookieToken = new Bun.CookieMap(req.headers.get("cookie") ?? "").get(
    authCookieName(auth.port),
  );
  if (matches(bearerToken(req), auth.token) || matches(cookieToken, auth.token)) return null;
  return reject(url);
}
