// Pins the budget gate: the failure text has to name the overage and the biggest files,
// the walk has to see nested directories (one that missed them would under-count and pass
// a build that broke an alias), the recorded number has to stay bracketed by the
// measurements it was derived from, and vite.config.ts has to still run the thing.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  budgetFailure,
  bundleBudgetPlugin,
  MEASURED_BYTES,
  measureDist,
  UI_BUNDLE_BUDGET_BYTES,
} from "./bundle-budget.ts";

describe("budgetFailure", () => {
  test("passes a build under budget", () => {
    expect(budgetFailure([{ path: "assets/index.js", bytes: 400 }], 1000)).toBeNull();
  });

  // The budget is a ceiling, not an exclusive bound: a build that lands exactly on the
  // recorded number has not grown past it.
  test("passes a build sitting exactly on the budget", () => {
    const files = [
      { path: "assets/index.js", bytes: 600 },
      { path: "index.html", bytes: 400 },
    ];
    expect(budgetFailure(files, 1000)).toBeNull();
  });

  test("reports the measured total, the budget and the overage", () => {
    const files = [
      { path: "assets/index.js", bytes: 900 },
      { path: "assets/onig.wasm", bytes: 430 },
      { path: "index.html", bytes: 100 },
    ];

    const failure = budgetFailure(files, 1000);

    // Matched as whole rendered lines: a bare toContain("430") would also be satisfied by
    // the digits inside "1430", so deleting the overage line would not red this.
    expect(failure).toMatch(/measured\s+1430 bytes/);
    expect(failure).toMatch(/budget\s+1000 bytes/);
    expect(failure).toMatch(/over by\s+430 bytes/);
    expect(failure).toContain("resolve.alias"); // the place to look before raising it
  });

  test("lists the five largest files, biggest first", () => {
    const files = Array.from({ length: 8 }, (_, i) => ({ path: `f${i}.js`, bytes: (i + 1) * 100 }));

    const failure = budgetFailure(files, 100) ?? "";
    const listed = [...failure.matchAll(/^ +\d+ {2}(f\d\.js)$/gm)].map((m) => m[1]);

    expect(listed).toEqual(["f7.js", "f6.js", "f5.js", "f4.js", "f3.js"]);
  });
});

describe("measureDist", () => {
  test("totals every file, however deeply nested", () => {
    const dir = mkdtempSync(join(tmpdir(), "caret-bundle-budget-"));
    mkdirSync(join(dir, "assets", "nested"), { recursive: true });
    writeFileSync(join(dir, "index.html"), "ab");
    writeFileSync(join(dir, "assets", "index.js"), "abcd");
    writeFileSync(join(dir, "assets", "nested", "grammar.js"), "abcdef");

    const files = measureDist(dir);

    expect(files.map((f) => f.bytes).reduce((a, b) => a + b, 0)).toBe(12);
    expect(files.map((f) => f.path).sort()).toEqual([
      "assets/index.js",
      "assets/nested/grammar.js",
      "index.html",
    ]);
  });

  test("returns nothing for an empty directory", () => {
    expect(measureDist(mkdtempSync(join(tmpdir(), "caret-bundle-budget-")))).toEqual([]);
  });
});

// The constant is only defensible while the measurements it was derived from still bracket
// it: above the baseline so an ordinary build passes, below the smallest break a size
// budget can act on so the gate still fires. Raise one without the other and this reds.
describe("UI_BUNDLE_BUDGET_BYTES", () => {
  test("sits between the baseline and the smallest gateable break", () => {
    const gateable = Math.min(MEASURED_BYTES.shikiWasmBreak, MEASURED_BYTES.pierreThemeBreak);

    expect(UI_BUNDLE_BUDGET_BYTES).toBeGreaterThan(MEASURED_BYTES.baseline);
    expect(UI_BUNDLE_BUDGET_BYTES).toBeLessThan(MEASURED_BYTES.baseline + gateable);
  });

  // The bare `shiki` entry is excluded from the derivation above on the grounds that it is
  // too small to gate on. That is a measurement, so it can stop being true — if the entry
  // ever starts carrying a real payload, the exclusion needs revisiting rather than
  // inheriting.
  test("does not claim to cover the bare shiki entry, which is too small to gate", () => {
    expect(MEASURED_BYTES.shikiBarrelBreak).toBeLessThan(
      UI_BUNDLE_BUDGET_BYTES - MEASURED_BYTES.baseline,
    );
  });
});

// The gate is only a gate while vite.config.ts still runs it: drop the plugin from the
// plugins array and every assertion above stays green. Nothing else pins the wiring — the
// same reason generate-palette-css.test.ts pins app.css's @import.
describe("vite.config.ts wiring", () => {
  test("the build installs the gate", () => {
    const config = readFileSync(new URL("./vite.config.ts", import.meta.url), "utf8");
    expect(config).toContain("bundleBudgetPlugin()");
  });

  test("the plugin throws when the built directory is over budget", () => {
    const dir = mkdtempSync(join(tmpdir(), "caret-bundle-budget-"));
    writeFileSync(join(dir, "huge.js"), "x".repeat(64));

    const plugin = bundleBudgetPlugin(32);
    callHook(plugin.configResolved, { root: dir, build: { outDir: "." } });

    expect(() => callHook(plugin.writeBundle)).toThrow(/over the budget/);
  });

  test("the plugin names itself when the out dir was never resolved", () => {
    expect(() => callHook(bundleBudgetPlugin().writeBundle)).toThrow(/caret-bundle-budget/);
  });
});

/** Call a vite plugin hook directly. Vite types each hook as a function-or-object union
 * carrying a context `this` these two hooks never touch, so the suite unwraps to the
 * function and calls it with no context rather than staging a build to reach it. */
function callHook(hook: unknown, ...args: unknown[]): unknown {
  const fn = (typeof hook === "function" ? hook : (hook as { handler: unknown }).handler) as (
    ...a: unknown[]
  ) => unknown;
  return fn.apply(undefined, args);
}
