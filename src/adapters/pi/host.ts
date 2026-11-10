// pi's version floor and its `pi --version` reader, for the install preflight (EXC-2319)
// and doctor's `pi-host` check (EXC-2320).

import { isNewer, parseVersionTriple } from "@/lib/semver.ts";

/** The first release published as pi (`@earendil-works`) that caret supports. */
export const PI_FLOOR = "1.5.0";

export const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/** Runs `argv` and reports its exit code (null when killed) and stdout. May throw. */
export type VersionSpawn = (argv: readonly string[]) => { exitCode: number | null; stdout: string };

/** pi's install status. missing: the spawn threw, exited non-zero, or printed no
 * version. pre-rename: major 0 (published as @mariozechner/pi-coding-agent). too-old:
 * below PI_FLOOR. */
export type PiVersion =
  | { status: "missing" }
  | { status: "pre-rename" | "too-old" | "ok"; version: string };

/** The first X.Y.Z in `pi --version` output (1.5.0 prints a bare "1.5.0"), or null. */
export function parsePiVersion(stdout: string): string | null {
  const version = stdout.match(/\d+\.\d+\.\d+/)?.[0];
  return version !== undefined && parseVersionTriple(version) !== null ? version : null;
}

/** Runs `pi --version` through `spawn`. Never throws. */
export function readPiVersion(spawn: VersionSpawn = spawnVersion): PiVersion {
  let version: string | null;
  try {
    const res = spawn(["pi", "--version"]);
    version = res.exitCode === 0 ? parsePiVersion(res.stdout) : null;
  } catch {
    return { status: "missing" };
  }
  if (version === null) return { status: "missing" };
  if (version.startsWith("0.")) return { status: "pre-rename", version };
  if (isNewer(PI_FLOOR, version)) return { status: "too-old", version };
  return { status: "ok", version };
}

function spawnVersion(argv: readonly string[]): { exitCode: number | null; stdout: string } {
  // Synchronous on purpose: async `Bun.spawn`'s timeout kills only the direct child, and a
  // grandchild holding stdout keeps a pipe read waiting.
  const res = Bun.spawnSync([...argv], { timeout: 5_000, stdin: "ignore", stderr: "ignore" });
  return { exitCode: res.exitCode, stdout: res.stdout.toString() };
}
