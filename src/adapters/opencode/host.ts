// Which OpenCode is installed, and what that means for where caret's entry goes: v2 loads
// caret from `plugins`, while v1 before 1.18.16 refuses to start on that key at all, so an
// unreadable version falls back to `plugin`, which every OpenCode loads.

import type { PluginKey } from "@/adapters/opencode/config-plugin.ts";
import { parseVersionTriple } from "@/lib/semver.ts";

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
