import "../../test-setup.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type LogCapture, logCapture } from "../../test-helpers.ts";
import { getApproveMode, HttpError, putDraft, resolveReview, startPolling } from "./api.ts";
import { flush } from "./log.ts";
import type { Annotation, ClientReview, ResolveBody } from "@core/types";

// Shared URL-routing fetch double (test-helpers.ts): /api/logs POSTs are
// captured; the review/prefs endpoints answer from the per-test `respond` so
// each case can pick success, a non-2xx Response, or a rejected promise.
let respond: (url: string, options: RequestInit | undefined) => Promise<Response>;
let cap: LogCapture;

beforeEach(() => {
  respond = () => Promise.resolve(new Response(null, { status: 204 }));
  cap = logCapture((url, options) => respond(url, options));
});

afterEach(() => {
  cap.restore();
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const ID = "abc12345-6789-0000-0000-000000000000";

describe("resolveReview instrumentation", () => {
  test("success emits exactly one info record with id prefix, behavior, extras", async () => {
    respond = () => Promise.resolve(jsonResponse({ ok: true }));
    const body: ResolveBody = { behavior: "allow", acceptMode: "auto", feedback: "looks good" };

    await resolveReview(ID, body);
    flush();

    const records = cap.events();
    expect(records).toHaveLength(1);
    const rec = records[0]!;
    expect(rec.level).toBe("info");
    expect(rec.step).toBe("resolve");
    expect(rec.msg as string).toContain("abc12345");
    expect(rec.msg as string).toContain("allow");
    expect(rec.extra).toMatchObject({
      reviewId: ID,
      acceptMode: "auto",
      feedbackChars: "looks good".length,
    });
  });

  test("omits acceptMode and feedbackChars extras when absent", async () => {
    respond = () => Promise.resolve(jsonResponse({ ok: true }));

    await resolveReview(ID, { behavior: "deny" });
    flush();

    const extra = cap.events()[0]!.extra as Record<string, unknown>;
    expect(extra.reviewId).toBe(ID);
    expect(extra).not.toHaveProperty("acceptMode");
    expect(extra).not.toHaveProperty("feedbackChars");
  });

  test("a non-2xx response warns with the status and rejects with HttpError", async () => {
    respond = () => Promise.resolve(new Response(null, { status: 409 }));

    await expect(resolveReview(ID, { behavior: "allow" })).rejects.toBeInstanceOf(HttpError);
    flush();

    const records = cap.events();
    const warn = records.find((r) => r.level === "warn");
    expect(warn).toBeDefined();
    expect(warn!.step).toBe("resolve");
    expect(warn!.msg as string).toContain("http 409");
    expect(warn!.extra).toMatchObject({ reviewId: ID, status: 409 });
  });

  test("a network reject emits an error record and rejects", async () => {
    respond = () => Promise.reject(new Error("network down"));

    await expect(resolveReview(ID, { behavior: "allow" })).rejects.toThrow("network down");
    flush();

    const err = cap.events().find((r) => r.level === "error");
    expect(err).toBeDefined();
    expect(err!.step).toBe("resolve");
    expect(err!.extra).toMatchObject({ reviewId: ID });
  });
});

describe("putDraft instrumentation", () => {
  const annotations: Annotation[] = [
    { id: "a1", blockId: "b1", startOffset: 0, endOffset: 4, quote: "q", comment: "c" },
    { id: "a2", blockId: "b2", startOffset: 0, endOffset: 4, quote: "q", comment: "c" },
  ];

  test("success emits no record", async () => {
    respond = () => Promise.resolve(jsonResponse({ ok: true }));

    await putDraft(ID, { annotations, generalCommentDraft: "" });
    flush();

    expect(cap.events()).toHaveLength(0);
  });

  test("failure warns with annotationCount and rejects", async () => {
    respond = () => Promise.resolve(new Response(null, { status: 500 }));

    await expect(putDraft(ID, { annotations, generalCommentDraft: "" })).rejects.toBeInstanceOf(
      HttpError,
    );
    flush();

    const warn = cap.events().find((r) => r.level === "warn");
    expect(warn).toBeDefined();
    expect(warn!.step).toBe("draft");
    expect(warn!.extra).toMatchObject({ reviewId: ID, annotationCount: 2 });
  });
});

describe("getApproveMode instrumentation", () => {
  test("failure warns at step prefs and rejects", async () => {
    respond = () => Promise.reject(new Error("offline"));

    await expect(getApproveMode()).rejects.toThrow("offline");
    flush();

    const warn = cap.events().find((r) => r.level === "warn");
    expect(warn).toBeDefined();
    expect(warn!.step).toBe("prefs");
    expect(warn!.msg as string).toContain("approve mode read failed");
  });
});

describe("startPolling instrumentation", () => {
  // Build a ClientReview list of `n` placeholder reviews to drive count changes.
  function reviewsOfLength(n: number): ClientReview[] {
    return Array.from({ length: n }, (_, i) => ({ id: `r${i}` }) as unknown as ClientReview);
  }

  // Await until `predicate` holds or a deadline passes, polling real timers.
  // The deadline only bounds the failure case — generous so a loaded CI machine
  // (parallel suites, saturated event loop) can't outrun it and flake.
  async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error("until: timed out");
      await new Promise((r) => setTimeout(r, 1));
    }
  }

  test("two consecutive failures emit exactly one warn; recovery emits info failures:2", async () => {
    // Sequence: fail, fail, then succeed with one review.
    const sequence: Array<() => Promise<Response>> = [
      () => Promise.reject(new Error("down")),
      () => Promise.reject(new Error("down")),
      () => Promise.resolve(jsonResponse(reviewsOfLength(1))),
    ];
    let i = 0;
    // /api/health answers benignly (no instanceId) so it never consumes a
    // reviews-sequence slot — the sequence drives /api/reviews alone.
    respond = (url) =>
      url === "/api/health"
        ? Promise.resolve(jsonResponse({ service: "caret", version: "1" }))
        : sequence[Math.min(i++, sequence.length - 1)]!();

    let updates = 0;
    const stop = startPolling(() => updates++, 1);
    await until(() => updates >= 1);
    stop();
    flush();

    const records = cap.events();
    const warns = records.filter((r) => r.level === "warn" && r.step === "poll");
    expect(warns).toHaveLength(1);
    expect(warns[0]!.msg as string).toContain("poll failed");

    const recovered = records.find(
      (r) => r.level === "info" && r.step === "poll" && (r.msg as string).includes("recovered"),
    );
    expect(recovered).toBeDefined();
    expect(recovered!.extra).toMatchObject({ failures: 2 });
  });

  test("a review-count change emits a debug record with the new count", async () => {
    respond = () => Promise.resolve(jsonResponse(reviewsOfLength(3)));

    let updates = 0;
    const stop = startPolling(() => updates++, 1);
    await until(() => updates >= 1);
    stop();
    flush();

    const debug = cap.events().find((r) => r.level === "debug" && r.step === "poll");
    expect(debug).toBeDefined();
    expect(debug!.msg as string).toContain("reviews pending: 3");
    expect(debug!.extra).toMatchObject({ count: 3 });
  });
});

describe("startPolling daemon identity (onSwap)", () => {
  function reviewsOfLength(n: number): ClientReview[] {
    return Array.from({ length: n }, (_, i) => ({ id: `r${i}` }) as unknown as ClientReview);
  }

  async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error("until: timed out");
      await new Promise((r) => setTimeout(r, 1));
    }
  }

  // Route a startPolling test's two endpoints: /api/reviews answers from
  // `reviews` (a thunk so it can change across polls), /api/health from `health`
  // (likewise). Everything else (i.e. /api/logs) is left to the shared capture.
  function route(reviews: () => Response, health: () => Response) {
    respond = (url) => {
      if (url === "/api/health") return Promise.resolve(health());
      if (url === "/api/reviews") return Promise.resolve(reviews());
      return Promise.resolve(new Response(null, { status: 204 }));
    };
  }

  test("onSwap fires once when instanceId changes across a failure→recovery edge", async () => {
    // Health flips identity while the reviews poll is mid-outage; the recovery
    // edge re-checks identity and notices the swap.
    let instanceId = "aaaa1111";
    let reviewsFails = false;
    route(
      () => (reviewsFails ? new Response(null, { status: 503 }) : jsonResponse(reviewsOfLength(1))),
      () => jsonResponse({ service: "caret", version: "1", instanceId }),
    );

    const swaps: string[] = [];
    let updates = 0;
    const stop = startPolling(
      () => updates++,
      1,
      undefined,
      (id) => swaps.push(id),
    );
    // Let the baseline seed (start-of-poll health check) and one good poll land.
    await until(() => updates >= 1);
    // Now drive an outage, swap identity behind it, then recover.
    reviewsFails = true;
    instanceId = "bbbb2222";
    await new Promise((r) => setTimeout(r, 5));
    reviewsFails = false;
    await until(() => swaps.length >= 1);
    stop();
    flush();

    expect(swaps).toEqual(["bbbb2222"]);
  });

  test("onSwap does not fire when instanceId is unchanged", async () => {
    route(
      () => jsonResponse(reviewsOfLength(1)),
      () => jsonResponse({ service: "caret", version: "1", instanceId: "stable00" }),
    );

    const swaps: string[] = [];
    let updates = 0;
    const stop = startPolling(
      () => updates++,
      1,
      undefined,
      (id) => swaps.push(id),
    );
    await until(() => updates >= 8);
    stop();
    flush();

    expect(swaps).toEqual([]);
  });

  test("the periodic check catches a swap with no intervening failure", async () => {
    // A same-port takeover completes between 2s polls without any failed tick:
    // reviews never errors, so only the periodic ~5th-poll health check sees it.
    let instanceId = "first000";
    route(
      () => jsonResponse(reviewsOfLength(1)),
      () => jsonResponse({ service: "caret", version: "1", instanceId }),
    );

    const swaps: string[] = [];
    let updates = 0;
    const stop = startPolling(
      () => updates++,
      1,
      undefined,
      (id) => swaps.push(id),
    );
    await until(() => updates >= 1);
    instanceId = "second00";
    await until(() => swaps.length >= 1);
    stop();
    flush();

    expect(swaps).toEqual(["second00"]);
  });

  test("exactly one warn is logged under step poll with the opaque from/to ids", async () => {
    let instanceId = "from1234";
    route(
      () => jsonResponse(reviewsOfLength(1)),
      () => jsonResponse({ service: "caret", version: "1", instanceId }),
    );

    let updates = 0;
    const stop = startPolling(() => updates++, 1);
    await until(() => updates >= 1);
    instanceId = "to567890";
    await until(() => updates >= 8);
    stop();
    flush();

    const warns = cap
      .events()
      .filter(
        (r) =>
          r.level === "warn" &&
          r.step === "poll" &&
          (r.msg as string).includes("daemon instance changed"),
      );
    expect(warns).toHaveLength(1);
    expect(warns[0]!.extra).toMatchObject({ from: "from1234", to: "to567890" });
  });

  test("a pre-fix daemon (no instanceId) never fires onSwap", async () => {
    route(
      () => jsonResponse(reviewsOfLength(1)),
      () => jsonResponse({ service: "caret", version: "1" }),
    );

    const swaps: string[] = [];
    let updates = 0;
    const stop = startPolling(
      () => updates++,
      1,
      undefined,
      (id) => swaps.push(id),
    );
    await until(() => updates >= 8);
    stop();
    flush();

    expect(swaps).toEqual([]);
  });
});

describe("redaction — no body text reaches the wire", () => {
  test("feedback, quote, and comment text never appear in any /api/logs body", async () => {
    const FEEDBACK = "SENSITIVE-FEEDBACK-PHRASE";
    const QUOTE = "SENSITIVE-QUOTE-PHRASE";
    const COMMENT = "SENSITIVE-COMMENT-PHRASE";

    respond = () => Promise.resolve(jsonResponse({ ok: true }));
    await resolveReview(ID, { behavior: "deny", feedback: FEEDBACK });

    respond = () => Promise.resolve(new Response(null, { status: 500 }));
    await expect(
      putDraft(ID, {
        annotations: [
          { id: "a1", blockId: "b1", startOffset: 0, endOffset: 1, quote: QUOTE, comment: COMMENT },
        ],
        generalCommentDraft: "",
      }),
    ).rejects.toBeInstanceOf(HttpError);
    flush();

    const text = cap.text();
    expect(text).not.toContain(FEEDBACK);
    expect(text).not.toContain(QUOTE);
    expect(text).not.toContain(COMMENT);
  });
});
