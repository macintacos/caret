import "../../test-setup.ts";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Load every pref module so its definePref/defineFlagPref/registerPrefKey call runs
// and its key joins the registry. At runtime App's static import graph does this at
// boot; here it is explicit. A new pref module added without an import here surfaces
// as a scanned key missing from knownPrefKeys() below — which is the point.
import { knownPrefKeys } from "$lib/definePref.ts";
import "$lib/diffIndicatorsPref.ts";
import "$lib/diffStylePref.ts";
import "$lib/diffview/dragHint.ts";
import "$lib/prefs.ts";
import "$lib/shortcutHintsPref.ts";
import "$lib/theme.ts";
import "$lib/tocPref.ts";

// This is the structural guard the three-place key sync used to lack: it scans the
// source for every persisted caret.* localStorage key and asserts each one is
// registered, so a pref that forgets to register (as the drag-hint key once did,
// silently surviving `mise run dev --fresh`) fails the unit suite instead of
// drifting unnoticed.

const UI_SRC = join(import.meta.dir, "..");

// localStorage-shaped keys that are NOT user preferences, so they sit outside the
// `--fresh` reset set on purpose:
// - caret.freshApplied: a sessionStorage per-boot control marker (prefs.ts).
const NON_PREF_KEYS = new Set(["caret.freshApplied"]);

/** Every caret.* / caret:* string literal under ui/src (excluding tests) — the
 * candidate localStorage keys. */
function scanCaretKeys(): string[] {
  const keys = new Set<string>();
  for (const rel of readdirSync(UI_SRC, { recursive: true }) as string[]) {
    if (rel.endsWith(".test.ts")) continue;
    if (!rel.endsWith(".ts") && !rel.endsWith(".svelte")) continue;
    const src = readFileSync(join(UI_SRC, rel), "utf8");
    for (const m of src.matchAll(/["'`](caret[.:][A-Za-z0-9.:_-]+)["'`]/g)) {
      const key = m[1];
      if (key && !NON_PREF_KEYS.has(key)) keys.add(key);
    }
  }
  return [...keys].sort();
}

describe("every persisted caret.* localStorage key is registered", () => {
  const scanned = scanCaretKeys();

  test("the scan finds keys (guards against a vacuous pass)", () => {
    expect(scanned.length).toBeGreaterThan(0);
    expect(scanned).toContain("caret.theme");
  });

  for (const key of scanned) {
    test(`${key} is in knownPrefKeys()`, () => {
      expect(knownPrefKeys()).toContain(key);
    });
  }
});
