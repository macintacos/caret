import { describe, expect, test } from "bun:test";
import {
  extractAssetPaths,
  isHtmlContentType,
  isUsableAssetContentType,
  probeServedUi,
} from "../../scripts/tasks/lib/smoke-probe.ts";

describe("smoke probe: pure helpers", () => {
  test("extractAssetPaths pulls /assets/ URLs, deduped and sorted", () => {
    const html =
      '<link href="/assets/b-2.css"><script src="/assets/a-1.js"></script><script src="/assets/a-1.js"></script>';
    expect(extractAssetPaths(html)).toEqual(["/assets/a-1.js", "/assets/b-2.css"]);
  });

  test("extractAssetPaths returns [] when the index references no assets", () => {
    expect(extractAssetPaths("<!doctype html><h1>caret</h1>")).toEqual([]);
  });

  test("isHtmlContentType is case-insensitive and tolerates a charset", () => {
    expect(isHtmlContentType("text/html; charset=utf-8")).toBe(true);
    expect(isHtmlContentType("TEXT/HTML")).toBe(true);
    expect(isHtmlContentType("application/json")).toBe(false);
  });

  test("isUsableAssetContentType rejects empty and octet-stream", () => {
    expect(isUsableAssetContentType("application/javascript")).toBe(true);
    expect(isUsableAssetContentType("")).toBe(false);
    expect(isUsableAssetContentType("application/octet-stream")).toBe(false);
    expect(isUsableAssetContentType("APPLICATION/OCTET-STREAM")).toBe(false);
  });
});

// A fetch stub keyed by URL pathname, so probeServedUi can be driven without a
// real daemon. Each route describes the Response it serves.
interface Route {
  status?: number;
  ctype?: string;
  body?: string;
  json?: unknown;
}
function fakeFetch(routes: Record<string, Route>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = new URL(url).pathname;
    const r = routes[path];
    if (!r) return new Response("not found", { status: 404 });
    const headers = new Headers();
    if (r.ctype) headers.set("content-type", r.ctype);
    const body = r.json !== undefined ? JSON.stringify(r.json) : (r.body ?? "");
    return new Response(body, { status: r.status ?? 200, headers });
  }) as typeof fetch;
}

const BASE = "http://127.0.0.1:9999";
const OPTS = { label: "smoke", requireProduction: false, emptyAssetsHint: "broken embed?" };

// A well-formed served UI: HTML index referencing one asset, that asset 200 with
// a real MIME, and a caret production health payload.
function healthyRoutes(overrides: Record<string, Route> = {}): Record<string, Route> {
  return {
    "/": { ctype: "text/html; charset=utf-8", body: '<script src="/assets/app-1.js"></script>' },
    "/assets/app-1.js": { ctype: "application/javascript" },
    "/api/health": { json: { service: "caret", isDev: false } },
    ...overrides,
  };
}

describe("smoke probe: probeServedUi", () => {
  test("passes and returns the referenced assets for a healthy server", async () => {
    const assets = await probeServedUi(BASE, OPTS, fakeFetch(healthyRoutes()));
    expect(assets).toEqual(["/assets/app-1.js"]);
  });

  test("throws when GET / is not 200", async () => {
    const routes = healthyRoutes({ "/": { status: 500, ctype: "text/html" } });
    await expect(probeServedUi(BASE, OPTS, fakeFetch(routes))).rejects.toThrow(
      "GET / returned 500",
    );
  });

  test("throws when GET / is not HTML", async () => {
    const routes = healthyRoutes({ "/": { ctype: "application/json", body: "{}" } });
    await expect(probeServedUi(BASE, OPTS, fakeFetch(routes))).rejects.toThrow("Content-Type");
  });

  test("throws (with the hint) when the index references no assets", async () => {
    const routes = healthyRoutes({ "/": { ctype: "text/html", body: "<h1>caret</h1>" } });
    await expect(probeServedUi(BASE, OPTS, fakeFetch(routes))).rejects.toThrow("broken embed?");
  });

  test("throws when a referenced asset is not 200", async () => {
    const routes = healthyRoutes({ "/assets/app-1.js": { status: 404, ctype: "text/plain" } });
    await expect(probeServedUi(BASE, OPTS, fakeFetch(routes))).rejects.toThrow(
      "asset /assets/app-1.js returned 404",
    );
  });

  test("throws when an asset has an unhelpful Content-Type", async () => {
    const routes = healthyRoutes({ "/assets/app-1.js": { ctype: "application/octet-stream" } });
    await expect(probeServedUi(BASE, OPTS, fakeFetch(routes))).rejects.toThrow("unhelpful");
  });

  test("throws when /api/health is not caret", async () => {
    const routes = healthyRoutes({ "/api/health": { json: { service: "other" } } });
    await expect(probeServedUi(BASE, OPTS, fakeFetch(routes))).rejects.toThrow(
      "service is 'other'",
    );
  });

  test("with requireProduction, throws when the install reports isDev", async () => {
    const routes = healthyRoutes({ "/api/health": { json: { service: "caret", isDev: true } } });
    await expect(
      probeServedUi(BASE, { ...OPTS, requireProduction: true }, fakeFetch(routes)),
    ).rejects.toThrow("isDev");
  });
});
