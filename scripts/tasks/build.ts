// `build` task group (EXC-738): the Svelte UI, the standalone binary, the
// distribution bundle, and the bare umbrella that chains UI -> binary. This
// consolidates what were the separate build-ui/build-bin/build-bundle/build
// tasks into one command whose `ui`/`bin`/`bundle` positional targets map to
// `mise run build <target>`.
//
// UI-first ordering lives here now, not in a mise `depends` edge: the
// ui-dependent targets (`bin`, `bundle`, and the umbrella) build the UI first
// via ensureUi() — UNLESS CARET_SKIP_BUILD_UI is set. That env var is how the
// preflight gate keeps the UI built exactly once: scripts/preflight.ts runs
// `build ui` on its own, then spawns `build bin` with CARET_SKIP_BUILD_UI=1 so
// two concurrent Vite builds can't race on ui/dist (the invariant the old
// MISE_TASK_SKIP=build-ui dedupe protected).

import { mkdirSync, rmSync } from "node:fs";
import { execAndExit, runForward } from "./lib/exec.ts";

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
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "inherit" });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) throw new Error("git rev-parse HEAD failed");
  return out.trim();
}

/** Compile the standalone binary from an already-built ui/dist: regenerate the
 * embed manifest (inline, not a mise dependency, so a bare `bash .mise/tasks/build
 * bin` from scripts/install.sh still works), compile, and copy the UI tree beside
 * the binary as a runtime fallback. Resolves the exit code (0 = ok) WITHOUT
 * exiting so the umbrella can chain past it. */
async function compileBin(run: typeof runForward = runForward): Promise<number> {
  mkdirSync("bin", { recursive: true });
  const manifest = await run(["bun", "scripts/generate-ui-manifest.ts"]);
  if (manifest !== 0) return manifest;
  const compiled = await run(buildBinCompileCommand(await headCommit()));
  if (compiled !== 0) return compiled;
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

export async function runBuildBin(): Promise<never> {
  process.exit(await buildBinArtifacts());
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
// Bare `mise run build`: build the UI then the binary (the old build-ui ->
// build-bin chain), with an optional --install step for the dev loop.

export interface BuildOptions {
  /** After building, install the local checkout + cycle the daemon (dev only). */
  install: boolean;
}

/** The install command `build --install` runs (EXC-555): delegate to
 * install.sh's --from-local mode, which reuses these artifacts (no rebuild),
 * reinstalls the plugin, and cycles the daemon to this build. Null when
 * --install was not passed, so a plain `build` never touches install.sh. */
export function buildInstallCommand(opts: BuildOptions): string[] | null {
  return opts.install ? ["scripts/install.sh", "--from-local"] : null;
}

export async function runBuild(opts: BuildOptions): Promise<never> {
  const code = await buildBinArtifacts();
  if (code !== 0) process.exit(code);
  console.log("caret build complete: bin/caret-native (run via the bin/caret shim)");
  const install = buildInstallCommand(opts);
  if (install === null) process.exit(0);
  process.exit(await runForward(install));
}
