import { expect, test } from "bun:test";

import { APPROVE_VARIANTS, setModeFor } from "@/adapters/claude/approve.ts";

test("the two accept variants map to their Claude session setMode names", () => {
  expect(setModeFor("acceptEdits")).toBe("acceptEdits");
  expect(setModeFor("auto")).toBe("auto");
});

test("a plain approve maps to no session mode change", () => {
  expect(setModeFor("default")).toBeUndefined();
});

test("an unrecognized or absent id never silently changes the session mode", () => {
  expect(setModeFor("turbo")).toBeUndefined();
  expect(setModeFor(undefined)).toBeUndefined();
});

test("every accept-variant id maps back to its own setMode name", () => {
  // The declared ids and the mapping stay in lockstep: each variant that maps to
  // a setMode name maps to a name matching its id.
  for (const variant of APPROVE_VARIANTS) {
    const mode = setModeFor(variant.id);
    if (mode) expect(mode).toBe(variant.id as typeof mode);
  }
});
