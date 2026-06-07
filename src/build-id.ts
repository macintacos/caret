// Build + commit fingerprinting and daemon identity: the signature a freshly
// built or installed caret uses to supersede an older running daemon, the
// version it reports, the UI asset-set digest, the shape of the single-instance
// lock, and the commit the daemon reports at startup. The build/commit resolvers
// wrap dependency-injected primitives (so the decision logic is unit-testable)
// and memoize the resolved value per process — neither can change while a process
// runs.
//
// Phase-0 spike outcome (the contract the rest of the code relies on): plan
// approval is gated via a `PermissionRequest` hook matching `ExitPlanMode` — NOT
// `PreToolUse` (which only permits the tool to run, so the native dialog still
// shows). See src/adapters/claude/ for the decision JSON this produces.

import { createHash } from "node:crypto";
import pkg from "../package.json" with { type: "json" };
import { loadUiAssets, type UiAssets } from "./ui-assets.ts";

/** The shipped version, read from package.json (one of the release-synced
 * manifests) at build time so it stays honest across releases. Hardcoding it was
 * a root cause of EXC-406: the daemon reported a stale "0.0.1" that could never
 * signal an upgrade. */
export const VERSION = pkg.version;

/** Identity signature returned by GET /api/health, used to detect a foreign
 * process squatting on the port. */
export const IDENTITY = { service: "caret", version: VERSION } as const;

/** True when running as a compiled binary (process.execPath IS caret), false
 * under `bun run` dev where argv[1] is the `.ts` entry script. The build
 * fingerprint, the daemon self-spawn vector, and the discovery report all key
 * off this one signal. */
export function isCompiledBinary(): boolean {
  return !process.argv[1]?.endsWith(".ts");
}

/** Short content fingerprint of the served UI asset set — the daemon's staleness
 * signal. It folds every asset's URL path and bytes (in sorted-path order, so
 * the digest is order-independent and deterministic across re-invocations of the
 * same build), so an upgraded binary's build differs from a still-running older
 * daemon's. Returns "no-ui" when no UI is available (dev / fresh checkout),
 * which compares equal across binaries in that same UI-less state. */
export async function buildHash(assets: UiAssets | undefined): Promise<string> {
  if (!assets || assets.paths.length === 0) return "no-ui";
  const h = createHash("sha256");
  // assets.paths is already sorted; hash path + bytes per asset so a moved,
  // added, removed, or rewritten file shifts the digest. The length-prefix on
  // each segment keeps the boundaries unambiguous (no path/bytes concatenation
  // collision).
  for (const urlPath of assets.paths) {
    const bytes = (await assets.file(urlPath)?.bytes()) ?? new Uint8Array();
    h.update(`${urlPath}\0${bytes.length}\0`);
    h.update(bytes);
  }
  return h.digest("hex").slice(0, 12);
}

/** Contents of the daemon lock file. Written by the daemon on bind; read by a
 * starting caret to discover and gracefully retire an older one. `build`/
 * `version` are optional so a partial/legacy lock still parses; `stateDir`/
 * `instanceId` (EXC-461) identify which world and which boot wrote the lock,
 * optional for the same reason. stateDir is identifying (contains the
 * username) — never log it; log instanceId instead. */
export interface DaemonLock {
  pid: number;
  port: number;
  build?: string;
  version?: string;
  startedAt?: number;
  stateDir?: string;
  instanceId?: string;
}

export interface BuildIdDeps {
  /** True when running as a compiled binary (process.execPath IS caret), false
   * under `bun run` dev. */
  isCompiled: boolean;
  /** Hash of the compiled binary's content, or null if it can't be read. */
  hashBinary: () => Promise<string | null>;
  /** Hash of the served UI asset set (the dev / fallback fingerprint). */
  uiHash: () => Promise<string>;
}

/** The build fingerprint used to decide daemon staleness. For a compiled binary
 * it's a hash of the binary itself, so ANY rebuild — UI or server code — yields a
 * new fingerprint and supersedes an older running daemon (a freshly built or
 * installed caret always wins); re-invoking the same binary still matches and
 * reuses. Dev (`bun run`, which is port-isolated and never uses takeover) falls
 * back to the UI hash. */
export async function computeBuildId(deps: BuildIdDeps): Promise<string> {
  if (deps.isCompiled) {
    const h = await deps.hashBinary();
    if (h) return h;
  }
  return deps.uiHash();
}

let cachedBuildId: string | undefined;

/** computeBuildId wired to the real binary/UI and memoized per process (the
 * build can't change while this process runs). */
export async function currentBuildId(): Promise<string> {
  if (cachedBuildId !== undefined) return cachedBuildId;
  cachedBuildId = await computeBuildId({
    isCompiled: isCompiledBinary(),
    hashBinary: async () => {
      try {
        const bytes = await Bun.file(process.execPath).bytes();
        return createHash("sha256").update(bytes).digest("hex").slice(0, 12);
      } catch {
        return null; // unreadable binary — fall back to the UI hash.
      }
    },
    uiHash: async () => buildHash(await loadUiAssets()),
  });
  return cachedBuildId;
}

export interface CommitDeps {
  /** The commit baked in at compile time, or undefined (dev, or a build that
   * skipped the --define). */
  baked: string | undefined;
  /** The source checkout's git HEAD, or null on any failure. */
  gitHead: () => string | null;
}

/** The commit the server runs from, logged in the listen record (EXC-452).
 * Prod binaries carry it baked via --define; dev resolves it from the source
 * checkout; otherwise "unknown". Never throws — a missing commit must not
 * destabilize boot. */
export function resolveCommit(deps: CommitDeps): string {
  if (deps.baked) return deps.baked;
  // || not ??: both branches treat any falsy value ("" included) as unset.
  return deps.gitHead() || "unknown";
}

let cachedCommit: string | undefined;

/** resolveCommit wired to the baked define and the real git, memoized per
 * process (the commit can't change while this process runs). */
export function currentCommit(): string {
  if (cachedCommit !== undefined) return cachedCommit;
  cachedCommit = resolveCommit({
    // Replaced with a string literal by `--define` in the build scripts
    // (.mise/tasks/build-bin, scripts/install.sh), so prod binaries can't be
    // overridden by runtime env. Deliberately NOT a user setting — it's a
    // build-time substitution token, exempt from the settings-rules.md
    // README-documentation requirement.
    baked: process.env.CARET_BUILD_COMMIT,
    gitHead: () => {
      try {
        // -C import.meta.dir (not cwd): the daemon may be spawned anywhere,
        // but in dev this module lives inside the source checkout. Handles
        // worktrees; inside a compiled binary the virtual dir fails fast.
        const r = Bun.spawnSync(["git", "-C", import.meta.dir, "rev-parse", "HEAD"]);
        if (r.exitCode !== 0) return null;
        const out = r.stdout.toString().trim();
        return out.length > 0 ? out : null;
      } catch {
        return null; // git not on PATH — spawnSync throws rather than failing.
      }
    },
  });
  return cachedCommit;
}
