// Shared fetch-stub scaffolding for UI tests that observe uiLog's wire batches
// (src/lib/log.ts buffers events and POSTs them to /api/logs). Install with
// logCapture() in beforeEach and restore() in afterEach: the module-global
// uiLog buffer is drained at install AND at restore — while the stub is live —
// so records can't bleed between cases or suites sharing one bun process.
// Imported as ../../test-helpers.ts by the lib tests (cf. test-setup.ts).
import { flush } from "./src/lib/log.ts";

export interface FetchCall {
  url: string;
  options: RequestInit | undefined;
}

/** Parse one captured /api/logs call's body into its event batch. */
export function batchEvents(call: FetchCall): Array<Record<string, unknown>> {
  const parsed = JSON.parse(call.options?.body as string) as {
    events: Array<Record<string, unknown>>;
  };
  return parsed.events;
}

export interface LogCapture {
  /** Captured /api/logs POSTs in arrival order. Same array identity for the
   * capture's lifetime, so a test installing its own fetch double can keep
   * recording into it (cf. log.test.ts's rejecting-fetch case). */
  calls: FetchCall[];
  /** Every captured batch's events, flattened in arrival order. */
  events(): Array<Record<string, unknown>>;
  /** Concatenated raw bodies — for negative (must-not-contain) assertions. */
  text(): string;
  /** Drain the buffer through the stub, then restore the original fetch. */
  restore(): void;
}

/**
 * Stub `globalThis.fetch`: `/api/logs` POSTs are captured (and answered 204);
 * any other URL routes to `respond` (default 204), so API-client tests can
 * answer their own endpoints per test.
 */
export function logCapture(
  respond: (url: string, options: RequestInit | undefined) => Promise<Response> = () =>
    Promise.resolve(new Response(null, { status: 204 })),
): LogCapture {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string, options?: RequestInit) => {
    if (url === "/api/logs") {
      calls.push({ url, options });
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return respond(url, options);
  }) as typeof globalThis.fetch;
  // Drain residue from prior cases/suites into the stub, then discard it so
  // this capture starts clean.
  flush();
  calls.length = 0;
  return {
    calls,
    events: () => calls.flatMap(batchEvents),
    text: () => calls.map((c) => c.options?.body as string).join(""),
    restore() {
      flush(); // drain this case's residue while the stub still captures it
      globalThis.fetch = originalFetch;
      calls.length = 0;
    },
  };
}
