import "@ui/support/setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { supportsViewTransition } from "$lib/viewTransition.ts";

// The probe gates production markup — App withholds its `.arrival` curtain on it —
// so both answers are pinned. happy-dom implements no View Transitions API, which is
// the false branch; the true branch stubs one onto the document and takes it back off,
// since the DOM globals are shared with every other UI test file.
describe("supportsViewTransition", () => {
  const untypedDocument = document as unknown as Record<string, unknown>;
  afterEach(() => {
    delete untypedDocument.startViewTransition;
  });

  test("false when the document has no View Transitions API", () => {
    expect(supportsViewTransition()).toBe(false);
  });

  test("true when the document exposes startViewTransition", () => {
    untypedDocument.startViewTransition = () => {};
    expect(supportsViewTransition()).toBe(true);
  });
});
