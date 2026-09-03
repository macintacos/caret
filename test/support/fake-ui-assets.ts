// A fake UiAssets handle over real temp files, so a resolver reads bytes
// through Bun.file (and its MIME) exactly as in production.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { UiAssets } from "@/ui/assets.ts";

/**
 * Build a `fakeAssets` function backed by throwaway temp dirs, plus a
 * `cleanup` that removes every dir it created. Each url path's basename
 * (extension included) is kept, index-prefixed to avoid collisions, so
 * `Bun.file` derives the same MIME the embedded path would.
 */
export function makeFakeUiAssets(): {
  fakeAssets: (files: Record<string, string>) => UiAssets;
  cleanup: () => void;
} {
  const dirs: string[] = [];
  return {
    fakeAssets(files) {
      const root = mkdtempSync(join(tmpdir(), "caret-ui-assets-"));
      dirs.push(root);
      const map: Record<string, string> = {};
      let i = 0;
      for (const [urlPath, content] of Object.entries(files)) {
        const safe = join(root, `${i++}-${urlPath.split("/").pop()}`);
        writeFileSync(safe, content);
        map[urlPath] = safe;
      }
      return {
        paths: Object.keys(map).sort(),
        file: (urlPath) => (map[urlPath] ? Bun.file(map[urlPath]) : undefined),
      };
    },
    cleanup() {
      for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    },
  };
}
