// Caret roots the launcher would run, for the cases that pin which one it picks.

import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A runnable caret root at `dir` whose package.json carries `packageJson` verbatim, or
 * has none when `packageJson` is undefined. */
export function runnableRoot(dir: string, packageJson: string | undefined): string {
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "bin", "caret"), "#!/usr/bin/env bash\n");
  chmodSync(join(dir, "bin", "caret"), 0o755);
  mkdirSync(join(dir, "ui", "dist"), { recursive: true });
  writeFileSync(join(dir, "ui", "dist", "index.html"), "");
  if (packageJson !== undefined) writeFileSync(join(dir, "package.json"), packageJson);
  return dir;
}

/** A pretty-printed manifest at `version`, with the `files` set a copy of it needs. */
export function manifest(version: string): string {
  return JSON.stringify({ name: "x", version, files: ["bin/", "ui/dist/"] }, null, 2);
}

/** A runnable root at `version` in a fresh temp dir. */
export function rootAt(version: string): string {
  return runnableRoot(mkdtempSync(join(tmpdir(), `caret-root-${version}-`)), manifest(version));
}
