// Best-effort reads of caret's published upstream state: npm's `latest`, GitHub's
// newest release tag, and how far trunk has moved past a given commit. Every read is
// bounded and degrades to null on any failure — non-200, unparseable body, missing or
// wrong-typed field, timeout, no network — because every caller (the daemon's update
// check, the OpenCode install's staleness verdict) treats an unreadable upstream as an
// `unknown` verdict that changes nothing, never as an error.
//
// The GitHub calls are unauthenticated and send nothing but a `user-agent`, so they
// cost the user no token and carry no identity.

import pkg from "../../package.json" with { type: "json" };

/** npm's `latest` dist-tag document for caret. Deliberately npm rather than GitHub
 * releases for the "what would an install get" question: `latest` is what OpenCode
 * re-resolves to, so it is the only honest answer. A release that tagged GitHub but
 * failed to publish would make the GitHub number a promise caret cannot keep. */
const NPM_LATEST_URL = `https://registry.npmjs.org/${pkg.name}/latest`;

/** GitHub's newest published release for caret — the answer for a compiled binary,
 * which npm never served. */
const LATEST_RELEASE_URL = "https://api.github.com/repos/macintacos/caret/releases/latest";

/** GitHub's commit comparison, `<commit>...trunk`: `ahead_by` is how many commits
 * trunk holds that the given commit does not. */
const COMPARE_URL = "https://api.github.com/repos/macintacos/caret/compare";

/** How long any upstream read waits. Bounded for the same reason every daemon fetch is
 * (`src/daemon/client.ts`): these run behind an install spinner or on the daemon's boot
 * path, and a blackholed connection would otherwise stall for the OS timeout. */
const UPSTREAM_TIMEOUT_MS = 3_000;

/** The slice of `fetch` these reads need — narrowed so a test injects a plain stub
 * without reconstructing the whole `typeof fetch` surface. `fetch` satisfies it. */
export type FetchLike = (
  url: string,
  init: { signal: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** The identity caret sends on its unauthenticated GitHub reads. */
const GITHUB_HEADERS = { "user-agent": "caret" } as const;

/** Fetch `url` and parse its body, or null when anything at all goes wrong. The one
 * "any failure → null" read the three public readers share; each then picks and
 * type-checks its own field. */
async function readJson(
  url: string,
  fetchImpl: FetchLike,
  headers?: Record<string, string>,
): Promise<unknown> {
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      ...(headers ? { headers } : {}),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** npm's `latest` version of caret, or null when the registry can't be reached, answers
 * non-200, or returns a document without a usable `version`. */
export async function publishedCaretVersion(fetchImpl: FetchLike = fetch): Promise<string | null> {
  const body = (await readJson(NPM_LATEST_URL, fetchImpl)) as { version?: unknown } | null;
  const v = body?.version;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** The tag on GitHub's newest caret release with any leading `v` stripped, so it
 * compares directly against the running `VERSION`. Null when the release can't be read
 * or carries no usable tag. */
export async function latestReleaseTag(fetchImpl: FetchLike = fetch): Promise<string | null> {
  const body = (await readJson(LATEST_RELEASE_URL, fetchImpl, GITHUB_HEADERS)) as {
    tag_name?: unknown;
  } | null;
  const tag = body?.tag_name;
  if (typeof tag !== "string" || tag.length === 0) return null;
  const stripped = tag.replace(/^v/, "");
  return stripped.length > 0 ? stripped : null;
}

/** How many commits trunk is ahead of `commit`, or null when the comparison can't be
 * read — an unknown commit (GitHub answers 404), a rate limit, or no network. Zero is
 * a real answer, not an absence: it means the build is on trunk's tip. */
export async function commitsAheadOfTrunk(
  commit: string,
  fetchImpl: FetchLike = fetch,
): Promise<number | null> {
  const body = (await readJson(`${COMPARE_URL}/${commit}...trunk`, fetchImpl, GITHUB_HEADERS)) as {
    ahead_by?: unknown;
  } | null;
  const ahead = body?.ahead_by;
  return typeof ahead === "number" && Number.isFinite(ahead) ? ahead : null;
}
