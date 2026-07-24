// What `caret install --from-local` needs and a published install never does: the guard
// that proves caret is running from a built checkout, the private dev marketplace that
// points Claude Code at that checkout, and the prewarm hand-off that retires the running
// daemon in favour of the fresh build.
//
// `--from-local` is an explicit flag, never inferred, and the guard here is its second
// line of defence: a published install ships neither `.claude-plugin/marketplace.json`
// (npm publishes only `plugin.json`) nor a compiled `bin/caret-native`, so it cannot
// reach the dev-marketplace path even if someone types the flag.
//
// The OpenCode target needs no equivalent: `loadOpencodePackaging()` resolves caret's
// root from argv[1]/execPath, so when the LOCAL binary runs `caret install` its command
// files already point at `<checkout>/bin/caret`. Local-ness is free there; only Claude
// Code, which installs from a marketplace rather than from the running binary, needs the
// generated marketplace below.

import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { resolveCaretRoot } from "@/adapters/opencode/packaging.ts";
import { stateDir } from "@/config/paths.ts";

/** What a target needs to install the local build rather than the published one: the
 * checkout to install, and where its generated marketplace is written. */
export interface LocalInstall {
  repoDir: string;
  marketplaceDir: string;
}

/** Injection seam for tests: the caret root to treat as the checkout, how the ref label is
 * read, and how the prewarm child is spawned — so the whole module runs against a temp dir
 * without `git` and without starting a daemon. */
export interface LocalDeps {
  root?: () => string;
  describe?: (repoDir: string) => string | null;
  spawn?: (cmd: string[]) => Promise<number>;
}

/** The generated dev marketplace's home. Under caret's own state dir so it is disposable:
 * every `--from-local` run regenerates it, and nothing else reads it. */
export function devMarketplaceDir(): string {
  return join(stateDir(), "dev-marketplace");
}

/** The checkout `--from-local` installs, with the ref label to report. Throws — with the
 * command that fixes it — when caret is not running from a checkout, or (unless
 * `requireArtifacts` is false, as it is for a preview) from one whose build artifacts are
 * missing. Missing artifacts are a misuse, not a fallback: this mode REUSES what
 * `mise run build` produced and never builds anything itself. */
export function resolveLocalCheckout(
  opts: { requireArtifacts?: boolean } = {},
  deps: LocalDeps = {},
): { repoDir: string; ref: string } {
  const repoDir = resolve(caretRoot(deps));
  if (!existsSync(join(repoDir, ".claude-plugin", "marketplace.json"))) {
    throw new Error(
      `--from-local must run from a caret checkout (no .claude-plugin/marketplace.json at ${repoDir}). A published caret installs with a plain \`caret install\`.`,
    );
  }
  if (opts.requireArtifacts !== false) {
    const missing = [
      isExecutable(join(repoDir, "bin", "caret-native")) ? null : "bin/caret-native",
      isDirectory(join(repoDir, "bin", "ui")) ? null : "bin/ui",
    ].filter((m) => m !== null);
    if (missing.length > 0) {
      throw new Error(
        `--from-local reuses the build artifacts bin/caret-native + bin/ui, and ${repoDir} is missing ${missing.join(" + ")} — run \`mise run build\` first.`,
      );
    }
  }
  return { repoDir, ref: (deps.describe ?? gitDescribe)(repoDir) ?? "unknown ref" };
}

/** caret's root, with root resolution's own failure restated in `--from-local` terms —
 * resolveCaretRoot describes the OpenCode packaging it looks for, which is not what a dev
 * running the dev loop is asking about. */
function caretRoot(deps: LocalDeps): string {
  if (deps.root) return deps.root();
  try {
    return resolveCaretRoot();
  } catch {
    throw new Error(
      "--from-local must run from a caret checkout, and this caret's root could not be resolved. Run it as the checkout's own `bin/caret` (what `mise run build --install` does).",
    );
  }
}

/** Write the private marketplace that makes Claude Code install THIS checkout. The
 * committed `.claude-plugin/marketplace.json` names an npm source, so the public
 * `macintacos/caret` marketplace always installs the published package; this one's single
 * plugin source is a symlink to the checkout, which Claude resolves at install time —
 * so every later build installs without regenerating anything. Regenerated from scratch
 * (not merged into) so a stale symlink can never survive a re-run. */
export function writeDevMarketplace(repoDir: string, outDir: string): void {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, ".claude-plugin"), { recursive: true });
  symlinkSync(resolve(repoDir), join(outDir, "caret"));
  writeFileSync(
    join(outDir, ".claude-plugin", "marketplace.json"),
    `${JSON.stringify(
      {
        name: "caret",
        description: "Local caret dev build (generated by caret install --from-local).",
        owner: { name: "macintacos" },
        plugins: [{ name: "caret", source: "./caret", description: "Local caret dev build." }],
      },
      null,
      2,
    )}\n`,
  );
}

/** Hand the daemon to the fresh build. The just-built binary's `prewarm` runs ensureDaemon,
 * whose build fingerprint differs from the running daemon's, so its same-world takeover
 * retires the old daemon and spawns this build — there is no explicit "kill the daemon"
 * step. Spawned rather than run in-process so the daemon that takes over is always the
 * BUILT binary, even when `caret install --from-local` itself runs from source.
 *
 * Best-effort by design, and it deliberately cannot report which path it took: ensureDaemon
 * REUSES (rather than retires) a daemon it can't step down — a legacy build with no
 * /api/retire endpoint and no lock file — which then keeps serving until it idle-exits. */
export async function prewarmLocalBuild(repoDir: string, deps: LocalDeps = {}): Promise<void> {
  const spawn = deps.spawn ?? runCaptured;
  try {
    await spawn([join(repoDir, "bin", "caret-native"), "prewarm"]);
  } catch {
    // A prewarm hiccup never fails an otherwise-clean install; the next review spawns the
    // daemon anyway.
  }
}

/** Is `path` a file this process can exec? The artifacts are checked the way they are
 * used — a `bin/caret-native` that won't run, or a `bin/ui` that is a file, is as absent
 * as a missing one. */
function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** `git describe` for the version label, or null when git fails (not a checkout, no git). */
function gitDescribe(repoDir: string): string | null {
  try {
    const proc = Bun.spawnSync(["git", "describe", "--tags", "--always", "--dirty"], {
      cwd: repoDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = proc.stdout.toString().trim();
    return proc.exitCode === 0 && out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Run a command with its output discarded, resolving its exit code. Discarded rather than
 * piped: nothing reads the output, and an unread pipe would block a chatty child. */
async function runCaptured(cmd: string[]): Promise<number> {
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  return await proc.exited;
}
