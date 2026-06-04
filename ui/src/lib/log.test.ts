import "../../test-setup.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { flush, startLogBridge, uiLog } from "./log.ts";

// A controllable fetch double: records every call's (url, options) and lets a
// test decide whether the next POST resolves or rejects. Restored in afterEach.
interface FetchCall {
  url: string;
  options: RequestInit | undefined;
}
let calls: FetchCall[];
let originalFetch: typeof globalThis.fetch;
let stopBridge: (() => void) | null;

function bodyEvents(call: FetchCall): Array<Record<string, unknown>> {
  const parsed = JSON.parse(call.options?.body as string) as {
    events: Array<Record<string, unknown>>;
  };
  return parsed.events;
}

beforeEach(() => {
  calls = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string, options?: RequestInit) => {
    calls.push({ url, options });
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof globalThis.fetch;
  stopBridge = null;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  stopBridge?.();
  // Drain any residue so cases don't bleed into each other.
  flush();
  calls = [];
});

describe("uiLog buffering and flush", () => {
  test("below-threshold events buffer; explicit flush makes one ordered POST", () => {
    uiLog.info("ui", "first");
    uiLog.warn("ui", "second");
    expect(calls).toHaveLength(0);

    flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/logs");
    expect((calls[0]!.options?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    const events = bodyEvents(calls[0]!);
    expect(events.map((e) => e.msg)).toEqual(["first", "second"]);
    expect(events[0]).toMatchObject({ level: "info", step: "ui", msg: "first" });
  });

  test("the 20th push auto-flushes one batch of 20", () => {
    for (let i = 0; i < 20; i++) uiLog.info("ui", `m${i}`);

    expect(calls).toHaveLength(1);
    expect(bodyEvents(calls[0]!)).toHaveLength(20);
  });

  test("a rejecting fetch throws nothing and drops the batch (no requeue)", async () => {
    globalThis.fetch = ((url: string, options?: RequestInit) => {
      calls.push({ url, options });
      return Promise.reject(new Error("network down"));
    }) as typeof globalThis.fetch;

    uiLog.info("ui", "doomed");
    expect(() => flush()).not.toThrow();
    expect(calls).toHaveLength(1);

    // Let the rejected promise settle; an unhandled rejection would surface here.
    await Promise.resolve();

    // The batch was swapped out before the request, so it is gone — a second
    // flush has nothing to send.
    flush();
    expect(calls).toHaveLength(1);
  });

  test("the ring cap keeps any single flushed batch at or under BUFFER_MAX", () => {
    // BUFFER_MAX (100) bounds a single flush's event count so it can never 413
    // on the endpoint's MAX_EVENTS. With FLUSH_THRESHOLD (20) draining first,
    // batches are normally ~20; the drop-oldest ring is the backstop that holds
    // the line at 100 if a drain ever stops happening. Drive a heavy burst and
    // assert the structural guarantee the cap exists for.
    for (let i = 0; i < 250; i++) uiLog.debug("ui", `e${i}`);
    flush();
    for (const call of calls) {
      expect(bodyEvents(call).length).toBeLessThanOrEqual(100);
    }
    expect(calls.length).toBeGreaterThan(0);
  });

  test("DENY_KEYS values are censored at construction, recursively", () => {
    const original = { plan: "secret", nested: { feedback: "f", keep: "ok" } };
    uiLog.info("ui", "m", original);
    flush();

    const extra = bodyEvents(calls[0]!)[0]!.extra as {
      plan: string;
      nested: { feedback: string; keep: string };
    };
    expect(extra.plan).toBe("<redacted>");
    expect(extra.nested.feedback).toBe("<redacted>");
    expect(extra.nested.keep).toBe("ok");
    // The caller's object must not be mutated by censoring.
    expect(original.plan).toBe("secret");
    expect(original.nested.feedback).toBe("f");
  });

  test("values beyond the depth cap are replaced, like src/redact.ts walk", () => {
    // A DENY_KEYS body nested past MAX_DEPTH must not ride through uncensored —
    // the daemon's scrubValue replaces it with "<depth-capped>", and the dev
    // mirror must never print what redaction would scrub.
    const deep = { b: { c: { d: { e: { f: { g: { plan: "deep secret" } } } } } } };
    uiLog.info("ui", "m", deep);
    flush();

    const body = JSON.stringify(bodyEvents(calls[0]!));
    expect(body).not.toContain("deep secret");
    expect(body).toContain("<depth-capped>");
  });

  test("error stringifies client-side: Error -> message, other -> String()", () => {
    uiLog.error("ui", new Error("boom"));
    uiLog.error("ui", { code: 7 });
    flush();

    const events = bodyEvents(calls[0]!);
    expect(events[0]).toMatchObject({ level: "error", step: "ui", msg: "boom" });
    expect(events[1]).toMatchObject({ level: "error", msg: "[object Object]" });
  });

  test("flush on an empty buffer makes no request", () => {
    flush();
    expect(calls).toHaveLength(0);
  });

  test("pagehide flush passes keepalive: true to fetch", () => {
    // Capture the registered pagehide handler — happy-dom may not dispatch
    // pagehide reliably, so invoke it directly.
    const handlers: Record<string, EventListenerOrEventListenerObject> = {};
    const realAdd = window.addEventListener.bind(window);
    window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject) => {
      handlers[type] = listener;
      return realAdd(type, listener);
    }) as typeof window.addEventListener;

    stopBridge = startLogBridge();
    window.addEventListener = realAdd;

    uiLog.info("ui", "before unload");
    (handlers.pagehide as EventListener)(new Event("pagehide"));

    expect(calls).toHaveLength(1);
    expect((calls[0]!.options as RequestInit).keepalive).toBe(true);
  });
});
