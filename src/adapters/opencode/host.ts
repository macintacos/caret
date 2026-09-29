// Which OpenCode is installed, and what that means for where caret's entry goes: v2 loads
// caret from `plugins`, while v1 before 1.18.16 refuses to start on that key at all, so an
// unreadable version falls back to `plugin`, which every OpenCode loads.

import type { PluginKey } from "@/adapters/opencode/config-plugin.ts";
import type { Check } from "@/doctor/report.ts";
import { isNewer, parseVersionTriple } from "@/lib/semver.ts";

/** Covers a cold v1 start (npm's node wrapper took 1.6 s) with margin. */
export const OPENCODE_VERSION_TIMEOUT_MS = 5_000;

/** "opencode v2.0.18" (v2) or a bare "1.14.17" (v1); null for anything else. */
export function parseOpencodeVersion(stdout: string): [number, number, number] | null {
  return parseVersionTriple(stdout.trim().replace(/^opencode /, ""));
}

/** Runs `<bin> --version`; null when bin is null, the exit is non-zero, the output does
 * not parse, or the bound kills it. Never throws. */
export function readOpencodeVersion(
  opts: { bin?: string | null; timeoutMs?: number } = {},
): [number, number, number] | null {
  const bin = opts.bin === undefined ? Bun.which("opencode") : opts.bin;
  if (bin === null) return null;
  try {
    // Synchronous on purpose: async `Bun.spawn`'s timeout kills only the direct child, and
    // a grandchild holding stdout (npm v1's node wrapper) keeps a pipe read waiting.
    const res = Bun.spawnSync([bin, "--version"], {
      timeout: opts.timeoutMs ?? OPENCODE_VERSION_TIMEOUT_MS,
      stdin: "ignore",
      stderr: "ignore",
    });
    return res.exitCode === 0 ? parseOpencodeVersion(res.stdout.toString()) : null;
  } catch {
    return null;
  }
}

export function pluginKeyFor(version: readonly [number, number, number] | null): PluginKey {
  return version !== null && version[0] >= 2 ? "plugins" : "plugin";
}

/** v1.3.4 is the first loader that accepts the plugin's object default. */
const V1_FLOOR = "1.3.4";

/** doctor's `opencode-host` check: whether the OpenCode on `PATH` loads caret from the keys
 * caret's entries sit in. Every fault joins into one fail, each with its remedy. */
export function hostCheck(
  version: readonly [number, number, number] | null,
  keys: readonly PluginKey[],
): Check {
  const base = { id: "opencode-host", title: "OpenCode host" };
  if (version === null) {
    return { ...base, status: "unknown", detail: "", reason: "couldn't read `opencode --version`" };
  }
  const v = version.join(".");
  const faults: string[] = [];
  const remedies: string[] = [];
  if (version[0] < 2 && isNewer(V1_FLOOR, v)) {
    faults.push(`OpenCode ${v} is older than ${V1_FLOOR}, the first that loads caret`);
    remedies.push(`upgrade OpenCode to ${V1_FLOOR} or later`);
  }
  const wrongKey = keys.find((k) => k !== pluginKeyFor(version));
  if (wrongKey === "plugins") {
    faults.push(
      `caret is in \`plugins\`, which OpenCode ${v} ignores; v1 before 1.18.16 will not start with it`,
    );
    remedies.push("run `caret install`");
  } else if (wrongKey === "plugin") {
    faults.push(`caret is in the legacy \`plugin\` key on OpenCode ${v}`);
    remedies.push("run `caret install`");
  }
  if (faults.length === 0) {
    return {
      ...base,
      status: "pass",
      detail: `OpenCode ${v} loads caret from \`${keys.join("`, `")}\``,
    };
  }
  return { ...base, status: "fail", detail: faults.join("; "), remedy: remedies.join("; ") };
}
