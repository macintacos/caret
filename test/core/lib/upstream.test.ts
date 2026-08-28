// caret's published upstream state: what npm's `latest` says, what GitHub's newest
// release is tagged, and how far trunk has moved past a given commit. Every read is
// best-effort — the suite drives each one against an injected fetch and pins that a
// non-200, an unparseable body, a missing or wrong-typed field, and a dead network
// all degrade to null rather than throwing.

import { expect, test } from "bun:test";

import {
  commitsAheadOfTrunk,
  type FetchLike,
  latestReleaseTag,
  publishedCaretVersion,
} from "@/lib/upstream.ts";

const PKG = "@macintacos/caret";

/** A fetch stub: one canned response, and a record of how it was called. A `body` of
 * `undefined` makes `json()` throw, standing in for an unparseable body. */
function fetching(response: { ok: boolean; body: unknown }): {
  fetchImpl: FetchLike;
  urls: string[];
  inits: { signal: AbortSignal; headers?: Record<string, string> }[];
} {
  const urls: string[] = [];
  const inits: { signal: AbortSignal; headers?: Record<string, string> }[] = [];
  return {
    urls,
    inits,
    fetchImpl: async (url, init) => {
      urls.push(url);
      inits.push(init);
      return {
        ok: response.ok,
        json: async () => {
          if (response.body === undefined) throw new SyntaxError("malformed JSON");
          return response.body;
        },
      };
    },
  };
}

/** A fetch that never answers — the offline / DNS-failure case. */
const offline: FetchLike = async () => {
  throw new Error("getaddrinfo ENOTFOUND");
};

// --- npm's latest dist-tag -------------------------------------------------------

test("the published version comes from npm's latest dist-tag document", async () => {
  const { fetchImpl, urls } = fetching({ ok: true, body: { version: "0.8.1" } });
  expect(await publishedCaretVersion(fetchImpl)).toBe("0.8.1");
  // npm's `latest`, not GitHub releases: it is what OpenCode actually re-resolves to.
  expect(urls).toEqual([`https://registry.npmjs.org/${PKG}/latest`]);
});

test("the version check is bounded, so a blackholed registry can't stall a caller", async () => {
  const { fetchImpl, inits } = fetching({ ok: true, body: { version: "0.8.1" } });
  await publishedCaretVersion(fetchImpl);
  expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
});

test("a non-200, a malformed body, and a thrown request all degrade to null", async () => {
  expect(await publishedCaretVersion(fetching({ ok: false, body: {} }).fetchImpl)).toBeNull();
  expect(await publishedCaretVersion(fetching({ ok: true, body: undefined }).fetchImpl)).toBeNull();
  expect(await publishedCaretVersion(fetching({ ok: true, body: {} }).fetchImpl)).toBeNull();
  expect(
    await publishedCaretVersion(fetching({ ok: true, body: { version: 7 } }).fetchImpl),
  ).toBeNull();
  expect(await publishedCaretVersion(offline)).toBeNull();
});

// --- GitHub's newest release -----------------------------------------------------

test("the latest release tag comes from GitHub's releases/latest, with the v stripped", async () => {
  const { fetchImpl, urls } = fetching({ ok: true, body: { tag_name: "v0.14.0" } });
  expect(await latestReleaseTag(fetchImpl)).toBe("0.14.0");
  expect(urls).toEqual(["https://api.github.com/repos/macintacos/caret/releases/latest"]);
});

test("the release read is unauthenticated and identifies itself as caret", async () => {
  const { fetchImpl, inits } = fetching({ ok: true, body: { tag_name: "v0.14.0" } });
  await latestReleaseTag(fetchImpl);
  expect(inits[0]?.headers).toEqual({ "user-agent": "caret" });
  expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
});

test("a release tag with no v prefix is taken as-is", async () => {
  const { fetchImpl } = fetching({ ok: true, body: { tag_name: "0.14.0" } });
  expect(await latestReleaseTag(fetchImpl)).toBe("0.14.0");
});

test("an unreadable release response degrades to null", async () => {
  expect(await latestReleaseTag(fetching({ ok: false, body: {} }).fetchImpl)).toBeNull();
  expect(await latestReleaseTag(fetching({ ok: true, body: undefined }).fetchImpl)).toBeNull();
  expect(await latestReleaseTag(fetching({ ok: true, body: {} }).fetchImpl)).toBeNull();
  expect(
    await latestReleaseTag(fetching({ ok: true, body: { tag_name: 7 } }).fetchImpl),
  ).toBeNull();
  expect(await latestReleaseTag(offline)).toBeNull();
});

// --- how far trunk has moved past a commit ---------------------------------------

test("the commit distance is GitHub's ahead_by for <commit>...trunk", async () => {
  const { fetchImpl, urls } = fetching({ ok: true, body: { ahead_by: 12 } });
  expect(await commitsAheadOfTrunk("abc1234", fetchImpl)).toBe(12);
  expect(urls).toEqual(["https://api.github.com/repos/macintacos/caret/compare/abc1234...trunk"]);
});

test("a commit trunk has not moved past reads as zero, not null", async () => {
  const { fetchImpl } = fetching({ ok: true, body: { ahead_by: 0 } });
  expect(await commitsAheadOfTrunk("abc1234", fetchImpl)).toBe(0);
});

test("the compare read is unauthenticated and identifies itself as caret", async () => {
  const { fetchImpl, inits } = fetching({ ok: true, body: { ahead_by: 1 } });
  await commitsAheadOfTrunk("abc1234", fetchImpl);
  expect(inits[0]?.headers).toEqual({ "user-agent": "caret" });
  expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
});

test("an unreadable compare response degrades to null", async () => {
  expect(await commitsAheadOfTrunk("abc", fetching({ ok: false, body: {} }).fetchImpl)).toBeNull();
  const malformed = fetching({ ok: true, body: undefined }).fetchImpl;
  expect(await commitsAheadOfTrunk("abc", malformed)).toBeNull();
  expect(await commitsAheadOfTrunk("abc", fetching({ ok: true, body: {} }).fetchImpl)).toBeNull();
  const wrongType = fetching({ ok: true, body: { ahead_by: "3" } }).fetchImpl;
  expect(await commitsAheadOfTrunk("abc", wrongType)).toBeNull();
  expect(await commitsAheadOfTrunk("abc", offline)).toBeNull();
});
