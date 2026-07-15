import "../../../test-setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";

import { dismissDragHint, isDragHintDismissed } from "$lib/diffview/dragHint.ts";

// The drag-to-comment hint shows once, then stays dismissed across loads. The
// persistence is a pure localStorage seam (the view owns when to render it), so
// it is unit-testable here against the happy-dom localStorage wired by test-setup.

beforeEach(() => {
  localStorage.clear();
});

describe("drag hint dismissal", () => {
  test("starts undismissed on a fresh store", () => {
    expect(isDragHintDismissed()).toBe(false);
  });

  test("dismissDragHint marks it dismissed and persists", () => {
    dismissDragHint();
    expect(isDragHintDismissed()).toBe(true);
  });

  test("dismissal is idempotent", () => {
    dismissDragHint();
    dismissDragHint();
    expect(isDragHintDismissed()).toBe(true);
  });
});
