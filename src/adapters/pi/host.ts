// pi's version floor and its `pi --version` reader, for the install preflight (EXC-2319)
// and doctor's `pi-host` check (EXC-2320).

import { runBounded } from "@/lib/run.ts";
import { isNewer, parseVersionTriple } from "@/lib/semver.ts";

/** The first release published as pi (`@earendil-works`) that caret supports. */
export const PI_FLOOR = "1.5.0";

/** pi's npm package since the rename from `@mariozechner/pi-coding-agent`. */
export const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/** Runs `argv` and reports its exit code (null when killed) and stdout. May throw. */
export type VersionSpawn = (
  argv: readonly string[],
) => Promise<{ exitCode: number | null; stdout: string }>;

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

/** What is wrong with `version` and what fixes it; null when pi can take caret. */
export function piVersionFault(version: PiVersion): { detail: string; remedy: string } | null {
  switch (version.status) {
    case "ok":
      return null;
    case "missing":
      return {
        detail: "Couldn't run `pi --version`",
        remedy: `install \`${PI_PACKAGE}\` ${PI_FLOOR} or later`,
      };
    case "too-old":
      return {
        detail: `pi ${version.version} is older than ${PI_FLOOR}`,
        remedy: `upgrade \`${PI_PACKAGE}\` to ${PI_FLOOR} or later`,
      };
    case "pre-rename":
      return {
        detail: `pi ${version.version} is the old \`@mariozechner/pi-coding-agent\``,
        remedy: `install \`${PI_PACKAGE}\` ${PI_FLOOR} or later, pi's package since the rename`,
      };
    default:
      return version satisfies never;
  }
}

/** Runs `pi --version` through `spawn`. Never throws. */
export async function readPiVersion(spawn: VersionSpawn = spawnVersion): Promise<PiVersion> {
  let version: string | null;
  try {
    const res = await spawn(["pi", "--version"]);
    version = res.exitCode === 0 ? parsePiVersion(res.stdout) : null;
  } catch {
    return { status: "missing" };
  }
  if (version === null) return { status: "missing" };
  if (version.startsWith("0.")) return { status: "pre-rename", version };
  if (isNewer(PI_FLOOR, version)) return { status: "too-old", version };
  return { status: "ok", version };
}

function spawnVersion(argv: readonly string[]) {
  return runBounded(argv, 5_000);
}
