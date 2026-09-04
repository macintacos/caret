// The size assertion vite.config.ts installs over ui/dist after every build (EXC-1217).
// Split like generate-palette-css.ts, its neighbour at the ui/ root: a pure half
// (budgetFailure) the colocated suite drives with synthetic file lists, and a filesystem
// half (measureDist) that reads a real build. Imported rather than spawned — it pulls in
// nothing but node builtins and a vite type, so the import keeps the budget type-checked
// against its one consumer.
//
// Total bytes over dist/ rather than entry-chunk size: every payload the alias block
// excludes would arrive as a lazily-imported chunk, which an entry-chunk budget would
// not see.

import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Plugin } from "vite";

/** What ui/dist measured at EXC-1224, each with `bunx vite build` from ui/ and one alias
 * entry of ui/vite.config.ts's `resolve.alias` block deleted. The budget below is derived
 * from these, and bundle-budget.test.ts reds if the two drift apart.
 *
 * Their deltas overlap, so none can be derived from the others by subtraction — each
 * number here is its own build. */
export const MEASURED_BYTES = {
  /** A clean build, all three entries in place, across 417 files. */
  baseline: 12_719_017,
  /** Added by un-aliasing `/^shiki\/wasm$/` alone — the Oniguruma WASM binary, and the
   * break the "~600 KB" claim on package.json's @pierre/diffs pin names. */
  shikiWasmBreak: 622_310,
  /** Added by un-aliasing the `@pierre/theme/*` entry alone — the ten palette payloads.
   * The smallest break a size budget can act on, so it is what sets the headroom. */
  pierreThemeBreak: 334_084,
  /** Added by un-aliasing the bare `/^shiki$/` entry alone. Two orders of magnitude
   * smaller than the other two, and the reason the constant below is explicit about what
   * it does not cover. */
  shikiBarrelBreak: 10_741,
} as const;

/** The ceiling the built UI is asserted against, in bytes.
 *
 * What it protects: the `shiki/wasm` and `@pierre/theme/` entries in ui/vite.config.ts's
 * `resolve.alias` block, which stub the Oniguruma WASM binary and the pierre theme
 * payloads that nothing in caret loads. Before this gate an entry that stopped matching (a
 * renamed specifier after a shiki or @pierre/diffs bump) grew the bundle and failed
 * nothing.
 *
 * `baseline + 180_983`: the headroom is a little over half of `pierreThemeBreak`, so
 * ordinary growth has ~177 KiB to move in while that break still overshoots by about as
 * much as it clears. A legitimate raise re-measures and updates MEASURED_BYTES above, not
 * just this number.
 *
 * What it does NOT protect, deliberately: the bare `/^shiki$/` entry. Un-aliasing it moves
 * dist/ by `shikiBarrelBreak` — well inside the noise any usable headroom has to tolerate
 * — because that entry is a behaviour swap (which regex engine, whose themes) rather than
 * a payload it keeps out. */
export const UI_BUNDLE_BUDGET_BYTES = 12_900_000;

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

/** A byte count as KiB/MiB, for the failure text — which prints the raw number beside it,
 * so the value stays greppable. */
function humanBytes(bytes: number): string {
  const [value, unit] =
    bytes >= 1024 * 1024 ? [bytes / (1024 * 1024), "MiB"] : [bytes / 1024, "KiB"];
  return `${value.toFixed(2)} ${unit}`;
}

/** The failure text for a build over `budget`, or null when it is within it. Pure.
 *
 * The budget is a ceiling rather than an exclusive bound: a build landing exactly on the
 * recorded number has not grown past it.
 *
 * Takes the budget as a parameter rather than reading UI_BUNDLE_BUDGET_BYTES so the suite
 * can drive it with synthetic sizes instead of staging a real build. The text names the
 * overage, the largest files and where to look, because a failure that says only "over
 * budget" teaches the reader to raise the number — the one outcome this gate exists to
 * prevent. */
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
    `  measured  ${String(total).padStart(10)} bytes (${humanBytes(total)})`,
    `  budget    ${String(budget).padStart(10)} bytes (${humanBytes(budget)})`,
    `  over by   ${String(total - budget).padStart(10)} bytes (${humanBytes(total - budget)})`,
    "",
    "Largest files:",
    ...largest,
    "",
    "Before raising UI_BUNDLE_BUDGET_BYTES, check ui/vite.config.ts's resolve.alias block.",
    "Two of its shiki entries are what hold this number down, and the measured cost of one",
    "ceasing to match — a renamed specifier after a shiki or @pierre/diffs bump — is",
    "+622 KB for shiki/wasm and +334 KB for @pierre/theme/. An overage near either is a",
    "broken alias until proven otherwise. If the growth is legitimate, re-measure and",
    "update MEASURED_BYTES in that file as well as the number.",
  ].join("\n");
}

/** The gate ui/vite.config.ts installs: measures dist/ after every build and throws when
 * it is over budget. Throwing from `writeBundle` fails `vite build` with a non-zero exit,
 * so every build path — `build ui`, `build bin`, `build bundle`, `test e2e`, preflight, a
 * hand-run `bunx vite build` — inherits the gate with no further wiring. `apply: "build"`
 * keeps it off the dev server.
 *
 * A factory rather than an object literal in the config, so `outDir` is a closure local
 * instead of a module-level mutable binding. It is captured in `configResolved` rather
 * than read from `writeBundle`'s `options.dir` — vite resolves that field to this same
 * absolute path — because its type admits undefined.
 *
 * @param budget - Defaults to the recorded budget; the suite passes a small one so the
 * throw path is reachable without staging a 12 MB directory. */
export function bundleBudgetPlugin(budget: number = UI_BUNDLE_BUDGET_BYTES): Plugin {
  let outDir = "";
  return {
    name: "caret-bundle-budget",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      // Unreachable while apply:"build" guarantees both hooks run together; without it a
      // bare readdirSync("") would report ENOENT and never name the plugin.
      if (!outDir) throw new Error("caret-bundle-budget: outDir was never resolved");
      const failure = budgetFailure(measureDist(outDir), budget);
      if (failure) throw new Error(failure);
    },
  };
}
