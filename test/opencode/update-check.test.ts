// Coverage for the OpenCode plugin's runtime bin/version resolution and the
// best-effort startup update-check toast (EXC-794). The plugin now runs from the
// npm package (array install) rather than a marker-substituted deployed file, so it
// resolves its binary and version at runtime; on load it checks caret's latest
// GitHub release and toasts a nudge when the user is behind. All logic is exercised
// through injected env / fetch / file-read / client — no network, no real files.

import { expect, test } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";
import {
  createCaretPlugin,
  isNewer,
  parseLatestRelease,
  realUpdateChecker,
  resolveCaretBin,
  resolveCaretVersion,
  updateToastBody,
} from "../../opencode/caret.plugin.ts";

// A client that records every toast realUpdateChecker surfaces.
function recordingClient(): {
  client: PluginInput["client"];
  toasts: Array<{ title?: string; message: string; variant: string }>;
} {
  const toasts: Array<{ title?: string; message: string; variant: string }> = [];
  const client = {
    tui: {
      showToast: (opts: { body: { title?: string; message: string; variant: string } }) => {
        toasts.push({
          title: opts.body.title,
          message: opts.body.message,
          variant: opts.body.variant,
        });
        return Promise.resolve({});
      },
    },
  } as unknown as PluginInput["client"];
  return { client, toasts };
}

// --- isNewer (inline semver) ---

test("isNewer compares semver triples, ignoring a leading v", () => {
  expect(isNewer("0.4.0", "0.3.0")).toBe(true);
  expect(isNewer("v0.3.1", "0.3.0")).toBe(true);
  expect(isNewer("1.0.0", "0.9.9")).toBe(true);
  expect(isNewer("0.3.0", "0.3.0")).toBe(false);
  expect(isNewer("0.3.0", "0.4.0")).toBe(false);
});

test("isNewer treats unparseable versions as not-newer (never nags on junk)", () => {
  expect(isNewer("nightly", "0.3.0")).toBe(false);
  expect(isNewer("0.4.0", "")).toBe(false);
});

// --- parseLatestRelease ---

test("parseLatestRelease pulls the tag (v-stripped) and release URL", () => {
  expect(parseLatestRelease({ tag_name: "v0.4.0", html_url: "https://x/r/0.4.0" })).toEqual({
    version: "0.4.0",
    url: "https://x/r/0.4.0",
  });
});

test("parseLatestRelease falls back to the releases page URL and rejects bad shapes", () => {
  expect(parseLatestRelease({ tag_name: "0.4.0" })?.url).toContain("github.com/macintacos/caret");
  expect(parseLatestRelease({})).toBeNull();
  expect(parseLatestRelease(null)).toBeNull();
  expect(parseLatestRelease("nope")).toBeNull();
});

// --- updateToastBody ---

test("updateToastBody returns a nudge when behind, null when current", () => {
  const body = updateToastBody("0.3.0", { version: "0.4.0", url: "https://x" });
  expect(body?.variant).toBe("info");
  expect(body?.message).toContain("0.4.0");
  expect(body?.message).toContain("0.3.0");
  expect(body?.message).toContain("https://x");
  expect(updateToastBody("0.4.0", { version: "0.4.0", url: "https://x" })).toBeNull();
});

// --- resolveCaretVersion ---

test("resolveCaretVersion prefers a substituted marker (file-deploy)", () => {
  expect(
    resolveCaretVersion({
      marker: "0.3.0",
      importMetaUrl: "file:///pkg/opencode/caret.plugin.ts",
      readFile: () => {
        throw new Error("should not read");
      },
    }),
  ).toBe("0.3.0");
});

test("resolveCaretVersion reads the sibling package.json when the marker is a placeholder (array install)", () => {
  expect(
    resolveCaretVersion({
      marker: "__CARET_VERSION__",
      importMetaUrl: "file:///pkg/opencode/caret.plugin.ts",
      readFile: (p) => {
        expect(p).toBe("/pkg/package.json");
        return JSON.stringify({ version: "1.2.3" });
      },
    }),
  ).toBe("1.2.3");
});

test("resolveCaretVersion degrades to an unparseable sentinel when the package.json is unreadable (never nags)", () => {
  const v = resolveCaretVersion({
    marker: "__CARET_VERSION__",
    importMetaUrl: "file:///pkg/opencode/caret.plugin.ts",
    readFile: () => {
      throw new Error("nope");
    },
  });
  expect(v).toBe("unknown");
  // The whole point of the sentinel: an unreadable version must NOT trigger a
  // spurious "update available (you have 0.0.0)" toast.
  expect(updateToastBody(v, { version: "9.9.9", url: "https://x" })).toBeNull();
});

// --- resolveCaretBin ---

test("resolveCaretBin: env override wins, then marker, then package-relative bin", () => {
  const importMetaUrl = "file:///pkg/opencode/caret.plugin.ts";
  expect(
    resolveCaretBin({
      env: { CARET_OPENCODE_BIN: "/override" },
      marker: "/deployed",
      importMetaUrl,
    }),
  ).toBe("/override");
  expect(resolveCaretBin({ env: {}, marker: "/deployed/bin/caret", importMetaUrl })).toBe(
    "/deployed/bin/caret",
  );
  expect(resolveCaretBin({ env: {}, marker: "__CARET_BIN__", importMetaUrl })).toBe(
    "/pkg/bin/caret",
  );
});

// --- realUpdateChecker (best-effort) ---

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

test("realUpdateChecker toasts when a newer release exists", async () => {
  const { client, toasts } = recordingClient();
  await realUpdateChecker(client, {
    currentVersion: "0.3.0",
    env: {},
    fetchImpl: async () => jsonResponse({ tag_name: "v0.4.0", html_url: "https://x/0.4.0" }),
  });
  expect(toasts).toHaveLength(1);
  expect(toasts[0]?.message).toContain("0.4.0");
});

test("realUpdateChecker is silent when already current", async () => {
  const { client, toasts } = recordingClient();
  await realUpdateChecker(client, {
    currentVersion: "0.4.0",
    env: {},
    fetchImpl: async () => jsonResponse({ tag_name: "v0.4.0", html_url: "https://x" }),
  });
  expect(toasts).toHaveLength(0);
});

test("realUpdateChecker is silent on a non-200 or a fetch error", async () => {
  const { client, toasts } = recordingClient();
  await realUpdateChecker(client, {
    currentVersion: "0.3.0",
    env: {},
    fetchImpl: async () => jsonResponse({ tag_name: "v0.4.0" }, false),
  });
  await realUpdateChecker(client, {
    currentVersion: "0.3.0",
    env: {},
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  expect(toasts).toHaveLength(0);
});

test("realUpdateChecker respects the CARET_OPENCODE_NO_UPDATE_CHECK opt-out", async () => {
  const { client, toasts } = recordingClient();
  let fetched = false;
  await realUpdateChecker(client, {
    currentVersion: "0.3.0",
    env: { CARET_OPENCODE_NO_UPDATE_CHECK: "1" },
    fetchImpl: async () => {
      fetched = true;
      return jsonResponse({ tag_name: "v0.4.0" });
    },
  });
  expect(fetched).toBe(false);
  expect(toasts).toHaveLength(0);
});

// --- checkUpdate wiring ---

test("createCaretPlugin fires checkUpdate at load only when wired", async () => {
  let called = 0;
  const plugin = createCaretPlugin({
    bin: "caret",
    run: async () => ({ stdout: "{}", exitCode: 0 }),
    checkUpdate: () => {
      called++;
    },
  });
  await plugin({ client: undefined } as unknown as PluginInput);
  expect(called).toBe(1);

  // No checkUpdate wired (the shape the existing tests use) => no network / no call.
  const bare = createCaretPlugin({
    bin: "caret",
    run: async () => ({ stdout: "{}", exitCode: 0 }),
  });
  await bare({ client: undefined } as unknown as PluginInput);
  expect(called).toBe(1);
});
