// `build` task group (EXC-738): the Svelte UI, the standalone binary, the
// distribution bundle, and the bare umbrella that chains UI -> binary. Its
// `ui`/`bin`/`bundle` positional targets map to `mise run build <target>`.
//
// UI-first ordering lives here rather than in a mise `depends` edge: the
// ui-dependent targets (`bin`, `bundle`, and the umbrella) build the UI first
// via ensureUi() — UNLESS CARET_SKIP_BUILD_UI is set. That env var is how the
// preflight gate keeps the UI built exactly once: scripts/preflight.ts runs
// `build ui` on its own, then spawns `build bin` with CARET_SKIP_BUILD_UI=1 so
// two concurrent Vite builds can't race on ui/dist.

import { mkdirSync, rmSync } from "node:fs";

import {
  execAndExit,
  runCapture,
  runForward,
  runQuietly,
  writeAndFlush,
} from "@/tasks/lib/exec.ts";
import { underProgressLine } from "@/tasks/lib/progress.ts";

// --- the generated first-paint palette ---------------------------------------
// ui/src/styles/palette.generated.css is emitted from THEMES["caret-dark"] and
// gitignored, so anything that consumes app.css has to generate it first. The
// vite config runs the generator itself (covering `build ui`, the dev server,
// and `test e2e`); the argv is exported here for the three entrypoints that
// never touch Vite — `test unit`, whose suites read the partial through
// lib/appCss.ts; `lint`, whose Tailwind step loads app.css as its theme; and
// `setup`, so a fresh clone can run the raw `bun test` CONTRIBUTING.md documents.

/** The argv that emits ui/src/styles/palette.generated.css. The script path is
 * repo-root-relative, which mise guarantees by running tasks from the config
 * root; the output path comes from import.meta.url, so it holds either way. */
export function paletteCssCommand(): string[] {
  return ["bun", "ui/generate-palette-css.ts"];
}

// --- build ui ---------------------------------------------------------------
// The Svelte UI built with Vite into ui/dist. It runs from the `ui/` workspace
// (its own vite config); extra args are forwarded to `vite build`.

/** The argv `build ui` runs (from the `ui/` directory), plus forwarded args. */
export function buildUiCommand(args: string[]): string[] {
  return ["bunx", "vite", "build", ...args];
}

export async function runBuildUi(args: string[]): Promise<never> {
  return execAndExit(buildUiCommand(args), { cwd: "ui" });
}

/** Whether a ui-dependent target should build the UI first. False only when
 * CARET_SKIP_BUILD_UI is set — the caller (the preflight gate) has already built
 * it, and a second concurrent Vite build would race on ui/dist. */
export function shouldBuildUi(env: Record<string, string | undefined>): boolean {
  return !env.CARET_SKIP_BUILD_UI;
}

/** Build the UI (from `ui/`) unless CARET_SKIP_BUILD_UI opts out, resolving the
 * child's exit code WITHOUT exiting so a caller can compile/bundle next. Shared
 * by the ui-dependent build targets and by `test e2e` (test.ts), so the skip
 * mechanism is honoured identically everywhere the UI is a prerequisite. */
export async function ensureUi(run: typeof runForward = runForward): Promise<number> {
  if (!shouldBuildUi(process.env)) return 0;
  return await run(buildUiCommand([]), { cwd: "ui" });
}

/** The bare-umbrella shape a multi-target task group runs (`assets`, `smoke`):
 * build the UI once up front — itself skipped under CARET_SKIP_BUILD_UI, so an
 * in-gate run reuses what preflight's own `build ui` produced — then run each
 * target in `group` as a fresh subprocess with the skip set, so no target pays
 * for the Vite build again. Stops at the first non-zero exit and returns it. The
 * runner is injectable so tests pin the sequence and the skip env without
 * spawning. */
export async function runTargetsAfterUi(
  group: string,
  targets: string[],
  run: typeof runForward = runForward,
): Promise<number> {
  if (shouldBuildUi(process.env)) {
    const ui = await run(["bun", "scripts/tasks/cli.ts", "build", "ui"]);
    if (ui !== 0) return ui;
  }
  const env = { ...(process.env as Record<string, string>), CARET_SKIP_BUILD_UI: "1" };
  for (const target of targets) {
    const code = await run(["bun", "scripts/tasks/cli.ts", group, target], { env });
    if (code !== 0) return code;
  }
  return 0;
}

// --- build bin --------------------------------------------------------------
// Compile src/cli.ts into the single standalone caret binary (bun build
// --compile). Regenerates the embed manifest from ui/dist first so the compile
// embeds each UI asset by its `with { type: "file" }` import, then keeps the
// built UI tree beside the binary as the asset resolver's beside-the-binary
// fallback. Output is bin/caret-native, NOT bin/caret — bin/caret is the
// committed shim (EXC-643) that execs this compiled binary when present.

/** The `bun build --compile` argv, baking the commit into the binary via
 * --define (EXC-452) so the daemon can log the revision it runs from, and
 * embedding the sourcemap (EXC-451) so stack frames keep their src/*.ts paths. */
export function buildBinCompileCommand(commit: string): string[] {
  return [
    "bun",
    "build",
    "--compile",
    "--sourcemap",
    `--define=process.env.CARET_BUILD_COMMIT="${commit}"`,
    "--outfile",
    "bin/caret-native",
    "src/cli.ts",
  ];
}

/** Read HEAD's commit sha, throwing if git fails (e.g. not a checkout) so the
 * build aborts loudly instead of baking an empty commit into the binary. */
async function headCommit(): Promise<string> {
  // git's diagnostics are piped, not inherited: the umbrella build renders a live
  // progress line, and anything written straight to stderr would land on top of it.
  // They ride along in the thrown error instead.
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git rev-parse HEAD failed: ${err.trim()}`);
  return out.trim();
}

/** Compile the standalone binary from an already-built ui/dist: regenerate the
 * embed manifest (inline, not a mise dependency, so a bare `bash .mise/tasks/build
 * bin` outside mise still works), compile, and copy the UI tree beside
 * the binary as a runtime fallback. Resolves the exit code (0 = ok) WITHOUT
 * exiting so the umbrella can chain past it. */
async function compileBin(run: typeof runForward = runForward): Promise<number> {
  mkdirSync("bin", { recursive: true });
  const manifest = await run(["bun", "scripts/generate-ui-manifest.ts"]);
  if (manifest !== 0) return manifest;
  const compiled = await run(buildBinCompileCommand(await headCommit()));
  if (compiled !== 0) return compiled;
  // Clear bin/ui before copying: `cp -R ui/dist bin/ui` copies INTO the directory
  // when it already exists, which would bury this build at bin/ui/dist/ and leave
  // the first build's index.html + assets/ stranded at the top level — exactly
  // where the beside-the-binary fallback looks, so it would serve a stale index
  // whose hashed asset URLs resolve to nothing.
  const cleaned = await run(["rm", "-rf", "bin/ui"]);
  if (cleaned !== 0) return cleaned;
  return await run(["cp", "-R", "ui/dist", "bin/ui"]);
}

/** Build the UI (unless skipped) then compile the binary. Shared by `build bin`
 * and the bare `build` umbrella. The runner is injectable so tests pin the
 * UI-first ordering + the skip without spawning Vite/the compiler. */
export async function buildBinArtifacts(run: typeof runForward = runForward): Promise<number> {
  const ui = await ensureUi(run);
  if (ui !== 0) return ui;
  return await compileBin(run);
}

/** Build the UI then the binary with every child's output captured instead of
 * inherited, resolving the exit code alongside the full combined log. `onLine`
 * receives each chunk's last displayable line so a caller can show progress.
 * The spawner is injectable for the same reason buildBinArtifacts' is. */
export async function buildBinArtifactsQuietly(
  onLine: (line: string) => void,
  spawn: typeof runCapture = runCapture,
): Promise<{ code: number; output: string }> {
  return await runQuietly(buildBinArtifacts, onLine, spawn);
}

export async function runBuildBin(): Promise<never> {
  process.exit(await buildBinArtifacts());
}

/** Whether a bin-dependent target should compile the binary first. False only
 * when CARET_SKIP_BUILD_BIN is set — the caller (the preflight gate) has already
 * compiled it as its own task, and a second compile is pure duplicated work. */
export function shouldBuildBin(env: Record<string, string | undefined>): boolean {
  return !env.CARET_SKIP_BUILD_BIN;
}

/** Compile the binary unless CARET_SKIP_BUILD_BIN opts out, resolving the child's
 * exit code WITHOUT exiting so a caller can go on to use the artifact. Spawned
 * through the tasks CLI (not buildBinArtifacts directly) so the compile keeps its
 * own process. `ensureUi`'s sibling one artifact up — used by `smoke bin`. */
export async function ensureBin(run: typeof runForward = runForward): Promise<number> {
  if (!shouldBuildBin(process.env)) return 0;
  return await run(["bun", "scripts/tasks/cli.ts", "build", "bin"]);
}

// --- build bundle -----------------------------------------------------------
// The distribution bundle for the GitHub/npm plugin install (EXC-643). Unlike
// build bin (a compiled standalone binary), this is a NON-compile `bun build`: a
// single dist/cli.js with every dependency inlined, so it runs on `bun` alone
// with no node_modules. The UI is served from the on-disk ui/dist tree shipped
// BESIDE the bundle, NOT from an embedded manifest — a non-compile `bun build`
// would rewrite the manifest's `with { type: "file" }` imports to cwd-relative
// paths that 500 at runtime, so any manifest a prior build bin left behind is
// removed first (build bin regenerates it next run).

/** The non-compile `bun build` argv producing dist/cli.js. */
export function buildBundleCommand(): string[] {
  return ["bun", "build", "--target=bun", "--outdir", "dist", "src/cli.ts"];
}

export async function runBuildBundle(): Promise<never> {
  const ui = await ensureUi();
  if (ui !== 0) process.exit(ui);
  rmSync("src/ui-manifest.generated.ts", { force: true });
  rmSync("dist", { recursive: true, force: true });
  const code = await runForward(buildBundleCommand());
  if (code === 0) {
    console.log("caret bundle complete: dist/cli.js (serves UI from sibling ui/dist)");
  }
  process.exit(code);
}

// --- build (umbrella) -------------------------------------------------------
// Bare `mise run build`: build the UI then the binary, with an optional
// --install step for the dev loop.

export interface BuildOptions {
  /** After building, install the local checkout + cycle the daemon (dev only). */
  install: boolean;
}

/** The install command `build --install` runs (EXC-555): the caret that was just
 * built, in its own `--from-local` mode — it reuses these artifacts (no rebuild),
 * reinstalls the plugin from a dev marketplace pointing at this checkout, and
 * hands the daemon to this build. Invoked through the bin/caret shim, the same
 * entrypoint Claude Code's hooks use, so the dev loop exercises the real path.
 * Null when --install was not passed, so a plain `build` installs nothing. */
export function buildInstallCommand(opts: BuildOptions): string[] | null {
  return opts.install ? ["bin/caret", "install", "--from-local"] : null;
}

export async function runBuild(opts: BuildOptions): Promise<never> {
  const { code, output } = await underProgressLine("building caret", buildBinArtifactsQuietly);
  if (code !== 0) {
    await writeAndFlush(process.stderr, output);
    process.exit(code);
  }
  console.log("caret build complete: bin/caret-native (run via the bin/caret shim)");
  const install = buildInstallCommand(opts);
  if (install === null) process.exit(0);
  process.exit(await runForward(install));
}
