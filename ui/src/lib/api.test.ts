import "../../test-setup.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type LogCapture, logCapture } from "../../test-helpers.ts";
import { getApproveMode, HttpError, putDraft, resolveReview, startPolling } from "./api.ts";
import { flush } from "./log.ts";
import type { Annotation, ClientReview, ResolveBody } from "./types.ts";

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
    respond = () => sequence[Math.min(i++, sequence.length - 1)]!();

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
