// Shared tree-building helper for suites that populate a throwaway cwd with
// real files.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Write `content` to `<root>/<rel>`, creating parent directories as needed. */
export function writeTreeFile(root: string, rel: string, content = "x"): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

/** Create a throwaway temp dir under `prefix` and populate it with `files`
 * (path relative to the root → content), creating parent directories as
 * needed. Returns the root; the caller removes it. */
export function fakeDistDir(prefix: string, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const [rel, content] of Object.entries(files)) writeTreeFile(root, rel, content);
  return root;
}
