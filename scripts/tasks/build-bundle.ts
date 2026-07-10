// `build-bundle` task: the distribution bundle for the GitHub/npm plugin install
// (EXC-643). Unlike build-bin (a compiled standalone binary), this is a
// NON-compile `bun build`: a single dist/cli.js with every dependency inlined,
// so it runs on `bun` alone with no node_modules. The hook shim (bin/caret)
// execs `bun dist/cli.js` when no compiled binary is present.
//
// The UI is served from the on-disk ui/dist tree shipped BESIDE the bundle
// (ui-assets.ts resolver source #2), NOT from an embedded manifest — a
// non-compile `bun build` would rewrite the manifest's `with { type: "file" }`
// imports to cwd-relative paths that 500 at runtime, so any manifest a prior
// build-bin left behind is removed first (build-bin regenerates it next run).

import { rmSync } from "node:fs";
import { runForward } from "./lib/exec.ts";

/** The non-compile `bun build` argv producing dist/cli.js. */
export function buildBundleCommand(): string[] {
  return ["bun", "build", "--target=bun", "--outdir", "dist", "src/cli.ts"];
}

export async function runBuildBundle(): Promise<never> {
  rmSync("src/ui-manifest.generated.ts", { force: true });
  rmSync("dist", { recursive: true, force: true });
  const code = await runForward(buildBundleCommand());
  if (code === 0) {
    console.log("caret bundle complete: dist/cli.js (serves UI from sibling ui/dist)");
  }
  process.exit(code);
}
