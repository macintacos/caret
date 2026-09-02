// Pins the budget gate: the failure text has to name the overage and the biggest
// files, because a failure that says only "over budget" trains a reader to raise
// the number — which is the one outcome this gate exists to prevent. The measured
// half is pinned too: a walk that missed a nested directory would under-count, and
// the gate would pass a build that broke the alias.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { budgetFailure, measureDist, UI_BUNDLE_BUDGET_BYTES } from "./bundle-budget.ts";

describe("budgetFailure", () => {
  test("passes a build under budget", () => {
    expect(budgetFailure([{ path: "assets/index.js", bytes: 400 }], 1000)).toBeNull();
  });

  // The budget is a ceiling, not an exclusive bound: a build that lands exactly on
  // the recorded number has not grown past it.
  test("passes a build sitting exactly on the budget", () => {
    const files = [
      { path: "assets/index.js", bytes: 600 },
      { path: "index.html", bytes: 400 },
    ];
    expect(budgetFailure(files, 1000)).toBeNull();
  });

  test("reports the overage and the largest files over budget", () => {
    const files = [
      { path: "assets/index.js", bytes: 900 },
      { path: "assets/onig.wasm", bytes: 400 },
      { path: "index.html", bytes: 100 },
    ];

    const failure = budgetFailure(files, 1000);

    expect(failure).toBeString();
    expect(failure).toContain("1400"); // the measured total
    expect(failure).toContain("1000"); // the budget
    expect(failure).toContain("400"); // the overage
    expect(failure).toContain("assets/index.js"); // the largest file, listed first
    expect(failure).toContain("resolve.alias"); // the place to look before raising it
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
});

// The constant is only defensible while the numbers its comment cites still bracket
// it: above the measured baseline so an ordinary build passes, below the smallest
// measured break so the gate still fires. Reading them back out of the comment is
// what stops the number and its explanation drifting apart — raise one without the
// other and this reds.
describe("UI_BUNDLE_BUDGET_BYTES", () => {
  test("sits between the baseline and the smallest break its comment records", () => {
    const source = readFileSync(new URL("./bundle-budget.ts", import.meta.url), "utf8");
    const cited = (label: string): number => {
      const digits = source.match(new RegExp(`${label}: ([\\d_]+) bytes`))?.[1];
      expect(digits, `${label} is not recorded in the constant's comment`).toBeDefined();
      return Number(digits?.replaceAll("_", ""));
    };

    const baseline = cited("Baseline");
    const smallestBreak = baseline + cited("shiki/wasm un-aliased");

    expect(UI_BUNDLE_BUDGET_BYTES).toBeGreaterThan(baseline);
    expect(UI_BUNDLE_BUDGET_BYTES).toBeLessThan(smallestBreak);
  });
});
