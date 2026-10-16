import "@ui/support/setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { withBlockedStorage } from "@ui/support/storage.ts";
import {
  PLAN_VIEW_KEY,
  readPlanView,
  runsOn,
  SURFACE_BEHAVIORS,
  type SurfaceBehavior,
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

describe("runsOn", () => {
  test("every behavior runs on the source view", () => {
    expect(BEHAVIORS.every((b) => runsOn(b, "source"))).toBe(true);
  });

  test("no behavior runs in compare", () => {
    expect(BEHAVIORS.some((b) => runsOn(b, "compare"))).toBe(false);
  });

  test("codeChrome, fileReferences, commentThreads and headingTracking run on the preview", () => {
    expect(BEHAVIORS.filter((b) => runsOn(b, "preview"))).toEqual([
      "codeChrome",
      "fileReferences",
      "commentThreads",
      "headingTracking",
    ]);
  });

  test("line-comment creation gestures stay off the preview", () => {
    expect(runsOn("lineComments", "preview")).toBe(false);
  });
});
