// `build-bin` task: compile src/cli.ts into the single standalone caret binary
// (bun build --compile). Regenerates the embed manifest from ui/dist first so
// the compile embeds each UI asset by its `with { type: "file" }` import, then
// keeps the built UI tree beside the binary as the asset resolver's
// beside-the-binary fallback. Output is bin/caret-native, NOT bin/caret —
// bin/caret is the committed shim (EXC-643) that execs this compiled binary when
// present. build-ui must run first (the `#MISE depends=["build-ui"]` on the
// forwarder) so ui/dist exists at compile time.

import { mkdirSync } from "node:fs";
import { runForward } from "../tasks/exec.ts";

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

export async function runBuildBin(): Promise<never> {
  mkdirSync("bin", { recursive: true });
  // Generate the embed manifest inline (not a #MISE depends): scripts/install.sh
  // runs this task as bare `bash .mise/tasks/build-bin`, which resolves no mise
  // dependencies.
  const manifest = await runForward(["bun", "scripts/generate-ui-manifest.ts"]);
  if (manifest !== 0) process.exit(manifest);
  const compiled = await runForward(buildBinCompileCommand(await headCommit()));
  if (compiled !== 0) process.exit(compiled);
  // Fallback safety net: keep the built UI tree beside the binary in case the
  // embedded assets are ever unavailable at runtime.
  process.exit(await runForward(["cp", "-R", "ui/dist", "bin/ui"]));
}
