import "@ui/support/setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import type { RenderedPlan } from "$lib/planMarkdown.ts";
import {
  PLAN_VIEW_KEY,
  previewRenderer,
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

  test("a written preview reads back", () => {
    writePlanView("preview");
    expect(readPlanView()).toBe("preview");
  });
});

describe("runsOn", () => {
  test("every behavior runs on the source view", () => {
    expect(BEHAVIORS.every((b) => runsOn(b, "source"))).toBe(true);
  });

  test("no behavior runs on the preview or in compare", () => {
    expect(BEHAVIORS.some((b) => runsOn(b, "preview") || runsOn(b, "compare"))).toBe(false);
  });
});

describe("previewRenderer", () => {
  function counting(): { render: (text: string) => RenderedPlan; calls: () => number } {
    let calls = 0;
    const render = (text: string): RenderedPlan => {
      calls++;
      return { html: text } as unknown as RenderedPlan;
    };
    return { render, calls: () => calls };
  }

  test("renders repeated identical text once and returns the same object", () => {
    const fake = counting();
    const renderPreview = previewRenderer(fake.render);
    const first = renderPreview("# a");
    expect(renderPreview("# a") === first).toBe(true);
    expect(fake.calls()).toBe(1);
  });

  test("renders again for new text", () => {
    const fake = counting();
    const renderPreview = previewRenderer(fake.render);
    renderPreview("# a");
    renderPreview("# b");
    expect(fake.calls()).toBe(2);
  });
});
