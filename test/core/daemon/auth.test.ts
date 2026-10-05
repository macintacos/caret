import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bootDaemon, type TestDaemon } from "@test/support/daemon.ts";
import { makeFakeUiAssets } from "@test/support/fake-ui-assets.ts";
import { recordingLog } from "@test/support/recording-log.ts";
import { expectNeverLogsBody } from "@test/support/redaction.ts";

let dir: string;
let tokenFile: string;
let ui: ReturnType<typeof makeFakeUiAssets>;
const daemons: TestDaemon[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "caret-auth-"));
  tokenFile = join(dir, "daemon.token");
  ui = makeFakeUiAssets();
});

afterEach(() => {
  for (const d of daemons.splice(0)) d.stop();
  ui.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

async function boot(opts: { tokenFile?: string; log?: ReturnType<typeof recordingLog>["log"] }) {
  const d = await bootDaemon(dir, {
    ...opts,
    assets: ui.fakeAssets({ "/index.html": "<html></html>", "/assets/app-abc123.js": "x" }),
  });
  daemons.push(d);
  return d;
}

async function bootAuthed(log?: ReturnType<typeof recordingLog>["log"]) {
  const d = await boot({ tokenFile, log });
  return { d, token: readFileSync(tokenFile, "utf8").trim() };
}

const json = { "Content-Type": "application/json" };

describe("a token-gated daemon rejects requests without a credential", () => {
  const cases: Array<[string, (url: string) => RequestInit & { path: string }]> = [
    ["GET /", () => ({ path: "/" })],
    ["HEAD /", () => ({ path: "/", method: "HEAD" })],
    ["a hashed asset", () => ({ path: "/assets/app-abc123.js" })],
    ["GET /api/health", () => ({ path: "/api/health" })],
    ["GET /api/reviews", () => ({ path: "/api/reviews" })],
    [
      "same-origin POST /api/reviews",
      (url) => ({
        path: "/api/reviews",
        method: "POST",
        headers: { ...json, Origin: url },
        body: JSON.stringify({ sessionId: "S", cwd: "/tmp/p", plan: "# T" }),
      }),
    ],
    ["GET file", () => ({ path: "/api/reviews/abc/file?path=x" })],
    ["GET dir", () => ({ path: "/api/reviews/abc/dir" })],
    [
      "POST file-search",
      () => ({ path: "/api/reviews/abc/file-search", method: "POST", headers: json, body: "{}" }),
    ],
    [
      "POST resolve",
      () => ({ path: "/api/reviews/abc/resolve", method: "POST", headers: json, body: "{}" }),
    ],
    ["OPTIONS /api/reviews", () => ({ path: "/api/reviews", method: "OPTIONS" })],
    ["an unknown path", () => ({ path: "/nope" })],
  ];
  test.each(cases)("%s", async (_, make) => {
    const { d } = await bootAuthed();
    const { path, ...init } = make(d.url);
    const res = await fetch(`http://127.0.0.1:${d.port}${path}`, init);
    expect(res.status).toBe(401);
  });
});

test.each([
  ["an /api rejection", "/api/reviews"],
  ["a page rejection", "/"],
  ["a failed login", "/?token=wrong"],
])("%s carries the Bearer challenge", async (_, path) => {
  const { d } = await bootAuthed();
  const res = await fetch(`${d.url}${path}`, { redirect: "manual" });
  expect(res.status).toBe(401);
  expect(res.headers.get("www-authenticate")).toBe('Bearer realm="caret"');
});

test("the token under another port's cookie name fails", async () => {
  const { d, token } = await bootAuthed();
  const res = await fetch(`${d.url}/api/health`, {
    headers: { Cookie: `caret-auth-${d.port + 1}=${token}` },
  });
  expect(res.status).toBe(401);
});

test("an /api rejection is JSON with an error field that never names the token", async () => {
  const { d, token } = await bootAuthed();
  const res = await fetch(`${d.url}/api/reviews`);
  const body = (await res.json()) as { error?: unknown };
  expect(typeof body.error).toBe("string");
  expect(JSON.stringify(body)).not.toContain(token);
  expect(JSON.stringify(body)).not.toContain(dir);
});

test("a page rejection is HTML that never names the token", async () => {
  const { d, token } = await bootAuthed();
  const res = await fetch(`${d.url}/`);
  expect(res.headers.get("content-type")).toContain("text/html");
  const body = await res.text();
  expect(body).not.toContain(token);
  expect(body).not.toContain(dir);
});

test("a bearer token passes", async () => {
  const { d, token } = await bootAuthed();
  const res = await fetch(`${d.url}/api/health`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
});

test("the port-named cookie passes", async () => {
  const { d, token } = await bootAuthed();
  const res = await fetch(`${d.url}/api/health`, {
    headers: { Cookie: `caret-auth-${d.port}=${token}` },
  });
  expect(res.status).toBe(200);
});

test("a same-length wrong token fails", async () => {
  const { d, token } = await bootAuthed();
  const wrong = token.replace(/^./, (c) => (c === "A" ? "B" : "A"));
  const res = await fetch(`${d.url}/api/health`, { headers: { Authorization: `Bearer ${wrong}` } });
  expect(res.status).toBe(401);
});

test("a valid login link sets the cookie and redirects without the token", async () => {
  const { d, token } = await bootAuthed();
  const res = await fetch(`${d.url}/?token=${token}&review=abc`, { redirect: "manual" });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/?review=abc");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  const cookie = res.headers.get("set-cookie") ?? "";
  expect(cookie.startsWith(`caret-auth-${d.port}=`)).toBe(true);
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Lax");
  expect(cookie).toContain("Path=/");
  expect(Number(/Max-Age=(\d+)/.exec(cookie)?.[1])).toBeGreaterThan(0);
});

test("a login on a protocol-relative path redirects on-site", async () => {
  const { d, token } = await bootAuthed();
  const res = await fetch(`${d.url}//evil.com/?token=${token}`, { redirect: "manual" });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toMatch(/^\/(?!\/)/);
});

test("an invalid login is a 401 with no cookie", async () => {
  const { d } = await bootAuthed();
  const res = await fetch(`${d.url}/?token=wrong`, { redirect: "manual" });
  expect(res.status).toBe(401);
  expect(res.headers.get("set-cookie")).toBe(null);
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
});

test("a re-minted token invalidates the old one as a header and a cookie", async () => {
  const first = await bootAuthed();
  first.d.stop();
  rmSync(tokenFile);
  const { d, token } = await bootAuthed();
  expect(token).not.toBe(first.token);
  const bearer = await fetch(`${d.url}/api/health`, {
    headers: { Authorization: `Bearer ${first.token}` },
  });
  expect(bearer.status).toBe(401);
  const cookie = await fetch(`${d.url}/api/health`, {
    headers: { Cookie: `caret-auth-${d.port}=${first.token}` },
  });
  expect(cookie.status).toBe(401);
});

test("without a token file the daemon mints nothing and serves openly", async () => {
  const d = await boot({});
  expect(existsSync(join(dir, "daemon.token"))).toBe(false);
  expect((await fetch(`${d.url}/api/health`)).status).toBe(200);
});

test("logins and rejections never log the token", async () => {
  const { recs, log } = recordingLog();
  const { d, token } = await bootAuthed(log);
  await fetch(`${d.url}/?token=${token}`, { redirect: "manual" });
  await fetch(`${d.url}/?token=${token}x`, { redirect: "manual" });
  await fetch(`${d.url}/api/reviews`);
  await fetch(`${d.url}/api/reviews/abc/file?path=x`);
  expectNeverLogsBody(recs, token);
});
