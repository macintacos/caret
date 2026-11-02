import "@ui/support/setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { withBlockedStorage } from "@ui/support/storage.ts";
import {
  PLAN_OUTLINE_KEY,
  PLAN_VIEW_KEY,
  readPlanOutline,
  readPlanView,
  runsOn,
  SURFACE_BEHAVIORS,
  type SurfaceBehavior,
  writePlanOutline,
  writePlanView,
} from "$lib/planView.ts";

afterEach(() => localStorage.clear());

const BEHAVIORS = Object.keys(SURFACE_BEHAVIORS) as SurfaceBehavior[];

describe("plan view preference", () => {
  test("defaults to source on an empty store", () => {
    expect(readPlanView()).toBe("source");
  });

  test("defaults to source on an unrecognized value", () => {
    localStorage.setItem(PLAN_VIEW_KEY, "garbage");
    expect(readPlanView()).toBe("source");
  });

  test("defaults to source when storage throws", () => {
    withBlockedStorage(() => {
      expect(readPlanView()).toBe("source");
    });
  });

  test("a written preview reads back", () => {
    writePlanView("preview");
    expect(readPlanView()).toBe("preview");
  });
});

describe("plan outline preference", () => {
  test("the outline is shown on an empty store and on an unrecognized value", () => {
    expect(readPlanOutline()).toBe("shown");
    localStorage.setItem(PLAN_OUTLINE_KEY, "garbage");
    expect(readPlanOutline()).toBe("shown");
  });

  test("a hidden outline reads back hidden", () => {
    writePlanOutline("hidden");
    expect(readPlanOutline()).toBe("hidden");
  });
});

describe("runsOn", () => {
  test("every behavior runs on the source view", () => {
    expect(BEHAVIORS.every((b) => runsOn(b, "source"))).toBe(true);
  });

  test("no behavior runs in compare", () => {
    expect(BEHAVIORS.some((b) => runsOn(b, "compare"))).toBe(false);
  });

  test("codeChrome, fileReferences, search, keyboardCursor, keyboardComments, commentThreads, textComments and headingTracking run on the preview", () => {
    expect(BEHAVIORS.filter((b) => runsOn(b, "preview"))).toEqual([
      "codeChrome",
      "fileReferences",
      "search",
      "keyboardCursor",
      "keyboardComments",
      "commentThreads",
      "textComments",
      "headingTracking",
    ]);
  });

  test("the gutter's line-comment drag gestures stay off the preview", () => {
    expect(runsOn("lineComments", "preview")).toBe(false);
  });
});
