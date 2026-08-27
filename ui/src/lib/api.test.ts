import "@ui/test-setup.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { Annotation, DirListing, FileExcerpt, ResolveBody, SkillRef } from "@core/lib/types";
import { type LogCapture, logCapture } from "@ui/test-helpers.ts";
import {
  getApproveMode,
  getDiagnostics,
  getDirListing,
  getFileExcerpt,
  getHealth,
  getReview,
  getSkills,
  HttpError,
  markSeen,
  putDraft,
  resolveFileRefs,
  resolveReview,
  searchFiles,
} from "$lib/api.ts";
import { flush } from "$lib/log.ts";

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
    const body: ResolveBody = {
      behavior: "allow",
      acceptMode: "auto",
      feedback: "looks good",
    };

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

describe("resolveFileRefs", () => {
  test("returns each resolved path's kind, omitting what did not resolve", async () => {
    respond = () =>
      Promise.resolve(jsonResponse({ resolved: { "src/foo.ts": "file", "src/lib": "directory" } }));
    expect(await resolveFileRefs(ID, ["src/foo.ts", "src/lib", "src/ghost.ts"])).toEqual({
      "src/foo.ts": "file",
      "src/lib": "directory",
    });
  });

  test("posts the candidate paths to the review's file-refs route", async () => {
    let seen: { url: string; body: unknown } | undefined;
    respond = (url, options) => {
      seen = { url, body: JSON.parse(String(options?.body)) };
      return Promise.resolve(jsonResponse({ resolved: {} }));
    };
    await resolveFileRefs(ID, ["a.ts"]);
    expect(seen?.url).toContain(`/api/reviews/${ID}/file-refs`);
    expect(seen?.body).toEqual({ paths: ["a.ts"] });
  });

  test("short-circuits an empty path list without a request", async () => {
    let called = false;
    respond = () => {
      called = true;
      return Promise.resolve(jsonResponse({ resolved: {} }));
    };
    expect(await resolveFileRefs(ID, [])).toEqual({});
    expect(called).toBe(false);
  });

  test("degrades to nothing resolved (never throws) on a failed request", async () => {
    respond = () => Promise.resolve(new Response(null, { status: 500 }));
    expect(await resolveFileRefs(ID, ["a.ts"])).toEqual({});
  });
});

describe("getFileExcerpt", () => {
  const excerpt: FileExcerpt = {
    path: "a.ts",
    language: "typescript",
    startLine: 1,
    endLine: 5,
    lines: ["line 1"],
    totalLines: 5,
  };

  test("returns the excerpt for a resolved file", async () => {
    respond = () => Promise.resolve(jsonResponse(excerpt));
    expect(await getFileExcerpt(ID, "a.ts")).toEqual(excerpt);
  });

  test("encodes the path and line as query params on the review's file route", async () => {
    let seenUrl = "";
    respond = (url) => {
      seenUrl = url;
      return Promise.resolve(jsonResponse(excerpt));
    };
    await getFileExcerpt(ID, "src/a b.ts", 29);
    const parsed = new URL(seenUrl, "http://localhost");
    expect(parsed.pathname).toBe(`/api/reviews/${ID}/file`);
    expect(parsed.searchParams.get("path")).toBe("src/a b.ts");
    expect(parsed.searchParams.get("line")).toBe("29");
  });

  test("omits the line param when no line is given", async () => {
    let seenUrl = "";
    respond = (url) => {
      seenUrl = url;
      return Promise.resolve(jsonResponse(excerpt));
    };
    await getFileExcerpt(ID, "a.ts");
    expect(new URL(seenUrl, "http://localhost").searchParams.has("line")).toBe(false);
  });

  test("throws HttpError on a non-2xx response", async () => {
    respond = () => Promise.resolve(new Response(null, { status: 404 }));
    await expect(getFileExcerpt(ID, "ghost.ts")).rejects.toBeInstanceOf(HttpError);
  });
});

describe("getDirListing", () => {
  const listing: DirListing = {
    path: "src/lib",
    entries: [
      { name: "deep", kind: "directory" },
      { name: "util.ts", kind: "file" },
    ],
    total: 2,
  };

  test("returns the level for a resolved directory", async () => {
    respond = () => Promise.resolve(jsonResponse(listing));
    expect(await getDirListing(ID, "src/lib", "")).toEqual(listing);
  });

  test("sends both the anchor and the level on the review's dir route", async () => {
    // The pair is what makes the route's descent guard meaningful, so `root`
    // travels on every request rather than only the first — a level asked for
    // without its anchor is a 404.
    let seenUrl = "";
    respond = (url) => {
      seenUrl = url;
      return Promise.resolve(jsonResponse(listing));
    };
    await getDirListing(ID, "src/my lib", "src/my lib/deep");
    const parsed = new URL(seenUrl, "http://localhost");
    expect(parsed.pathname).toBe(`/api/reviews/${ID}/dir`);
    expect(parsed.searchParams.get("root")).toBe("src/my lib");
    expect(parsed.searchParams.get("path")).toBe("src/my lib/deep");
  });

  test("throws HttpError on a non-2xx response", async () => {
    // One 404 covers every refusal the route makes — a missing directory, an
    // escape, a descent past the guard — so the card has one failure to render.
    respond = () => Promise.resolve(new Response(null, { status: 404 }));
    await expect(getDirListing(ID, "src/lib", "src/ghost")).rejects.toBeInstanceOf(HttpError);
  });
});

describe("putDraft instrumentation", () => {
  const annotations: Annotation[] = [
    {
      id: "a1",
      blockId: "b1",
      startOffset: 0,
      endOffset: 4,
      quote: "q",
      comment: "c",
    },
    {
      id: "a2",
      blockId: "b2",
      startOffset: 0,
      endOffset: 4,
      quote: "q",
      comment: "c",
    },
  ];

  test("success emits no record", async () => {
    respond = () => Promise.resolve(jsonResponse({ ok: true }));

    await putDraft(ID, { annotations, generalCommentDraft: "", composerScratches: [] });
    flush();

    expect(cap.events()).toHaveLength(0);
  });

  test("failure warns with annotationCount and rejects", async () => {
    respond = () => Promise.resolve(new Response(null, { status: 500 }));

    await expect(
      putDraft(ID, { annotations, generalCommentDraft: "", composerScratches: [] }),
    ).rejects.toBeInstanceOf(HttpError);
    flush();

    const warn = cap.events().find((r) => r.level === "warn");
    expect(warn).toBeDefined();
    expect(warn!.step).toBe("draft");
    expect(warn!.extra).toMatchObject({ reviewId: ID, annotationCount: 2 });
  });

  test("forwards the composer scratches in the PUT body", async () => {
    let body: unknown;
    respond = (_url, options) => {
      body = JSON.parse(String(options?.body));
      return Promise.resolve(jsonResponse({ ok: true }));
    };
    const scratches = [{ startLine: 2, endLine: 3, text: "wip" }];
    await putDraft(ID, { annotations, generalCommentDraft: "", composerScratches: scratches });
    expect(body).toMatchObject({ composerScratches: scratches });
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

describe("getHealth instrumentation", () => {
  test("success emits no record", async () => {
    respond = () => Promise.resolve(jsonResponse({ service: "caret" }));

    await getHealth();
    flush();

    expect(cap.events()).toHaveLength(0);
  });

  test("failure warns at step request and rejects", async () => {
    respond = () => Promise.reject(new Error("offline"));

    await expect(getHealth()).rejects.toThrow("offline");
    flush();

    const warn = cap.events().find((r) => r.level === "warn");
    expect(warn).toBeDefined();
    expect(warn!.step).toBe("request");
    expect(warn!.msg as string).toContain("health probe failed");
  });
});

describe("getDiagnostics instrumentation", () => {
  const doc = {
    system: { platform: "darwin", arch: "arm64", runtime: "bun 1.2.19" },
    uptimeMs: 1000,
    settings: { daemon: { port: 42718 } },
    config: { path: "/x/config.toml", exists: true, env: [] },
  };

  test("returns the diagnostics document on success and emits no record", async () => {
    respond = () => Promise.resolve(jsonResponse(doc));

    expect(await getDiagnostics()).toEqual(doc);
    flush();

    expect(cap.events()).toHaveLength(0);
  });

  test("failure warns at step request and rejects", async () => {
    respond = () => Promise.reject(new Error("offline"));

    await expect(getDiagnostics()).rejects.toThrow("offline");
    flush();

    const warn = cap.events().find((r) => r.level === "warn");
    expect(warn).toBeDefined();
    expect(warn!.step).toBe("request");
    expect(warn!.msg as string).toContain("diagnostics probe failed");
  });
});

describe("getReview instrumentation", () => {
  test("success emits no record", async () => {
    respond = () => Promise.resolve(jsonResponse({ id: ID }));

    await getReview(ID);
    flush();

    expect(cap.events()).toHaveLength(0);
  });

  test("a non-2xx response warns with the id prefix and status", async () => {
    respond = () => Promise.resolve(new Response(null, { status: 404 }));

    await expect(getReview(ID)).rejects.toBeInstanceOf(HttpError);
    flush();

    const warn = cap.events().find((r) => r.level === "warn");
    expect(warn).toBeDefined();
    expect(warn!.step).toBe("request");
    expect(warn!.msg as string).toContain("abc12345");
    expect(warn!.msg as string).toContain("http 404");
    expect(warn!.extra).toMatchObject({ reviewId: ID, status: 404 });
  });

  test("a network reject emits an error record and rejects", async () => {
    respond = () => Promise.reject(new Error("network down"));

    await expect(getReview(ID)).rejects.toThrow("network down");
    flush();

    const err = cap.events().find((r) => r.level === "error");
    expect(err).toBeDefined();
    expect(err!.step).toBe("request");
    expect(err!.extra).toMatchObject({ reviewId: ID });
  });
});

describe("searchFiles", () => {
  test("returns the daemon's matches and which cap stopped it", async () => {
    respond = () => Promise.resolve(jsonResponse({ paths: ["src/foo.ts"], stoppedAt: "results" }));
    expect(await searchFiles(ID, "srfoo")).toEqual({
      paths: ["src/foo.ts"],
      stoppedAt: "results",
    });
  });

  test("posts the query to the review's file-search route", async () => {
    let seen: { url: string; body: unknown } | undefined;
    respond = (url, options) => {
      seen = { url, body: JSON.parse(String(options?.body)) };
      return Promise.resolve(jsonResponse({ paths: [], stoppedAt: null }));
    };
    await searchFiles(ID, "srlbfoo");
    expect(seen?.url).toContain(`/api/reviews/${ID}/file-search`);
    expect(seen?.body).toEqual({ query: "srlbfoo" });
  });

  test("degrades a failed request to no matches rather than throwing", async () => {
    // fileCompletion.ts leans on this: it treats "nothing came back" as its only
    // failure mode, so a rejection here would surface as an unhandled error in a
    // completion query rather than as a closed list.
    respond = () => Promise.reject(new Error("network down"));
    expect(await searchFiles(ID, "a")).toEqual({ paths: [], stoppedAt: null });

    respond = () => Promise.resolve(new Response(null, { status: 404 }));
    expect(await searchFiles(ID, "a")).toEqual({ paths: [], stoppedAt: null });
  });

  test("coerces a 2xx body missing or mis-typing its fields", async () => {
    // The defensive branch has no other way to run: a well-behaved daemon always
    // sends both fields.
    respond = () => Promise.resolve(jsonResponse({}));
    expect(await searchFiles(ID, "a")).toEqual({ paths: [], stoppedAt: null });

    respond = () => Promise.resolve(jsonResponse({ paths: ["a.ts"], stoppedAt: "nonsense" }));
    expect(await searchFiles(ID, "a")).toEqual({ paths: ["a.ts"], stoppedAt: null });
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
          {
            id: "a1",
            blockId: "b1",
            startOffset: 0,
            endOffset: 1,
            quote: QUOTE,
            comment: COMMENT,
          },
        ],
        generalCommentDraft: "",
        composerScratches: [],
      }),
    ).rejects.toBeInstanceOf(HttpError);
    flush();

    const text = cap.text();
    expect(text).not.toContain(FEEDBACK);
    expect(text).not.toContain(QUOTE);
    expect(text).not.toContain(COMMENT);
  });

  test("a completion query never appears in any /api/logs body", async () => {
    // The `@` query is reviewer-typed text on its way to becoming plan prose, so
    // it is the same class as the bodies above — and searchFiles logs its own
    // failures, which is the path that could carry it.
    const QUERY = "SENSITIVE-QUERY-PHRASE";
    respond = () => Promise.resolve(new Response(null, { status: 404 }));
    await searchFiles(ID, QUERY);
    flush();

    expect(cap.text()).not.toContain(QUERY);
  });
});

describe("markSeen", () => {
  test("posts to the review's seen route", async () => {
    let seen: { url: string; method: string | undefined } | undefined;
    respond = (url, options) => {
      seen = { url, method: options?.method };
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    await markSeen(ID);
    expect(seen?.url).toContain(`/api/reviews/${ID}/seen`);
    expect(seen?.method).toBe("POST");
  });

  test("swallows a failed request (never throws)", async () => {
    respond = () => Promise.resolve(new Response(null, { status: 500 }));
    expect(await markSeen(ID)).toBeUndefined();
  });

  test("swallows a network failure (never throws)", async () => {
    respond = () => Promise.reject(new Error("offline"));
    expect(await markSeen(ID)).toBeUndefined();
  });
});

describe("getSkills", () => {
  const skills: SkillRef[] = [
    { name: "git", origin: "user" },
    { name: "superpowers:brainstorming", origin: "plugin" },
  ];

  test("returns the reviewing agent's skills", async () => {
    respond = () => Promise.resolve(jsonResponse(skills));
    expect(await getSkills(ID)).toEqual(skills);
  });

  test("asks the review's own skills route, with the id encoded", async () => {
    let seenUrl = "";
    respond = (url) => {
      seenUrl = url;
      return Promise.resolve(jsonResponse(skills));
    };
    await getSkills("a b/c");
    expect(seenUrl).toBe("/api/reviews/a%20b%2Fc/skills");
  });

  test("answers a 404 with no skills — the unwired-daemon case", async () => {
    // A daemon that wires no skill capability 404s the route (the e2e fixture
    // daemon does exactly this). That is a settled answer, not a failure: the
    // empty list is the caller's to keep, and it records at `debug` like any
    // other ordinary answer.
    respond = () => Promise.resolve(new Response(null, { status: 404 }));
    expect(await getSkills(ID)).toEqual([]);
    await flush();
    expect(cap.events().some((r) => r.level === "debug" && r.step === "request")).toBe(true);
  });

  test("answers null when the request never lands, so the caller retries", async () => {
    // Offline, a 5xx, a daemon mid-restart: transient, and distinct from the 404
    // above — null is what tells the caller not to keep this answer.
    respond = () => Promise.reject(new Error("offline"));
    expect(await getSkills(ID)).toBeNull();
    await flush();
    expect(cap.events().some((r) => r.level === "warn" && r.step === "request")).toBe(true);
  });
});
