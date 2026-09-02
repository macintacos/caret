// The size assertion the caret-bundle-budget plugin in vite.config.ts runs over
// ui/dist after every build (EXC-1217). It lives at the ui/ root beside
// generate-palette-css.ts, the other build concern the config expresses as a plugin,
// and is split the same way: a pure half (budgetFailure) the colocated suite drives
// with synthetic file lists, and the filesystem half (measureDist) that reads a real
// build. Imported rather than spawned, unlike generate-palette-css.ts — that script
// is spawned because its module graph resolves $lib, and this one imports nothing
// but node builtins, so an import keeps the budget type-checked against its one
// consumer.
//
// Total bytes over dist/ rather than a narrower measure, because every payload the
// alias block excludes arrives as a lazily-imported chunk rather than as entry-chunk
// growth: an entry-chunk budget would not see any of it. Total bytes is also the
// number a human reproduces with `du -sb ui/dist`.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** The ceiling the built UI is asserted against, in bytes.
 *
 * What it protects: the three shiki-related entries in ui/vite.config.ts's
 * `resolve.alias` block. `/^shiki$/` routes the bare specifier @pierre/diffs imports
 * to caret's bundle shim, while the `shiki/wasm` and `@pierre/theme/` entries stub the
 * Oniguruma WASM binary and the pierre theme payloads that nothing in caret loads.
 * All three are purely additive — breaking one only ever makes dist/ bigger — and
 * before this gate an alias that stopped matching (a renamed specifier after a shiki
 * or @pierre/diffs bump) grew the bundle and failed nothing.
 *
 * Measured on trunk at EXC-1217, with `bunx vite build` from ui/:
 *
 *   Baseline: 12_735_092 bytes across 417 files.
 *   shiki/wasm un-aliased: 622_310 bytes more — the tightest constraint on the
 *     headroom, and the break the pin's own "~600 KB" claim in package.json names.
 *   All three un-aliased: 966_806 bytes more.
 *
 * The number sits roughly midway between the baseline and the smallest break, so an
 * ordinary dependency bump has ~315 KB to move in while that break still overshoots
 * by about as much as it clears. A legitimate raise re-measures and updates the
 * baseline above, not just the number — bundle-budget.test.ts reds if the two drift.
 */
export const UI_BUNDLE_BUDGET_BYTES = 13_050_000;

/** One emitted file, as measured under the dist root. */
export interface DistFile {
  /** Path relative to the dist root, `/`-separated — e.g. "assets/index-BucWCjoT.js". */
  path: string;
  bytes: number;
}

/** Every file under `distDir`, recursively. The filesystem half. */
export function measureDist(distDir: string): DistFile[] {
  const files: DistFile[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), path);
      else files.push({ path, bytes: statSync(join(dir, entry.name)).size });
    }
  };
  walk(distDir, "");
  return files;
}

/** Render a byte count the way a human reads it, alongside the raw number the
 * failure text keeps so the value stays greppable. */
function human(bytes: number): string {
  const [value, unit] = bytes >= 1024 * 1024 ? [bytes / (1024 * 1024), "MB"] : [bytes / 1024, "KB"];
  return `${value.toFixed(2)} ${unit}`;
}

/** The failure text for a build over `budget`, or null when it is within it. Pure.
 *
 * The budget is a ceiling rather than an exclusive bound: a build landing exactly on
 * the recorded number has not grown past it.
 *
 * Takes the budget as a parameter rather than reading UI_BUNDLE_BUDGET_BYTES so the
 * suite can drive it with synthetic sizes instead of staging a real build. The text
 * names the overage, the largest files, and where to look — following
 * test/structure/dependency-dedupe.test.ts's DUPLICATE_HINT, because a failure that
 * says only "over budget" teaches the reader to raise the number, which is the one
 * outcome this gate exists to prevent. */
export function budgetFailure(files: DistFile[], budget: number): string | null {
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  if (total <= budget) return null;

  const largest = [...files]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5)
    .map((file) => `  ${String(file.bytes).padStart(10)}  ${file.path}`);

  return [
    "The built UI is over the budget recorded in ui/bundle-budget.ts.",
    "",
    `  measured  ${String(total).padStart(10)} bytes (${human(total)})`,
    `  budget    ${String(budget).padStart(10)} bytes (${human(budget)})`,
    `  over by   ${String(total - budget).padStart(10)} bytes (${human(total - budget)})`,
    "",
    "Largest files:",
    ...largest,
    "",
    "Before raising UI_BUNDLE_BUDGET_BYTES, check ui/vite.config.ts's resolve.alias",
    "block: its three shiki entries are what hold this number down, and one that stops",
    "matching — a renamed specifier after a shiki or @pierre/diffs bump — adds ~600 KB",
    "on its own. If the growth is legitimate, re-measure and update the baseline in that",
    "constant's comment as well as the number.",
  ].join("\n");
}
