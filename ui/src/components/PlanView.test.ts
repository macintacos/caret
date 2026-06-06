import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import type { Annotation } from "@core/types";
import type { ResolvedAnnotation } from "../lib/planPaint.ts";
import { capture, render } from "../../test-mount.ts";
import PlanView from "./PlanView.svelte";

// The mark-painting/measuring logic is unit-tested in planPaint.test.ts; this
// suite covers PlanView's shell wiring: rendering the sanitized HTML, reporting
// resolutions up, and the click-to-focus path. Real text selection and popover
// positioning are exercised by the annotations e2e.

const ann = (over: Partial<Annotation>): Annotation => ({
  id: "a1",
  blockId: "b0",
  startOffset: 0,
  endOffset: 5,
  quote: "Hello",
  comment: "c",
  ...over,
});

const noopProps = {
  html: "",
  annotations: [] as Annotation[],
  activeId: null,
  onResolved: () => {},
  onCreate: () => {},
  onFocusAnnotation: () => {},
};

/** Wait a microtask so PlanView's queueMicrotask(paint) has run. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("PlanView render", () => {
  test("inlines the sanitized plan HTML into the article", () => {
    const { target } = render(PlanView, {
      ...noopProps,
      html: '<p id="b0">Hello world</p>',
    });
    const article = target.querySelector("article.plan")!;
    expect(article.querySelector("#b0")!.textContent).toBe("Hello world");
  });

  test("the article carries the document role for assistive tech", () => {
    const { target } = render(PlanView, noopProps);
    expect(target.querySelector("article.plan")!.getAttribute("role")).toBe("document");
  });

  test("does not render a comment popover until a selection is pending", () => {
    const { target } = render(PlanView, {
      ...noopProps,
      html: '<p id="b0">Hello world</p>',
    });
    expect(target.querySelector(".popover")).toBeNull();
  });
});

describe("PlanView resolution reporting", () => {
  test("reports the resolved annotations up after painting", async () => {
    const reported = capture<ResolvedAnnotation[]>();
    render(PlanView, {
      ...noopProps,
      html: '<p id="b0">Hello world</p>',
      annotations: [ann({})],
      onResolved: reported.cb,
    });
    await settle();
    expect(reported.last()).toHaveLength(1);
    expect(reported.last()![0]!.orphaned).toBe(false);
  });

  test("orphans an annotation whose block is absent from the html", async () => {
    const reported = capture<ResolvedAnnotation[]>();
    render(PlanView, {
      ...noopProps,
      html: '<p id="b0">Hello world</p>',
      annotations: [ann({ blockId: "bGone" })],
      onResolved: reported.cb,
    });
    await settle();
    expect(reported.last()![0]!.orphaned).toBe(true);
  });
});

describe("PlanView click-to-focus", () => {
  test("clicking a painted mark focuses its annotation", async () => {
    const focused = capture<string>();
    const { target } = render(PlanView, {
      ...noopProps,
      html: '<p id="b0">Hello world</p>',
      annotations: [ann({})],
      onFocusAnnotation: focused.cb,
    });
    await settle();
    const mark = target.querySelector("mark[data-annotation]") as HTMLElement;
    expect(mark).not.toBeNull();
    mark.click();
    expect(focused.last()).toBe("a1");
  });

  test("clicking outside any mark does not focus an annotation", async () => {
    let focused = false;
    const { target } = render(PlanView, {
      ...noopProps,
      html: '<p id="b0">Hello world</p>',
      annotations: [ann({})],
      onFocusAnnotation: () => (focused = true),
    });
    await settle();
    (target.querySelector("#b0") as HTMLElement).click();
    expect(focused).toBe(false);
  });
});
