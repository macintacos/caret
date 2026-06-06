import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import type { HeadingEntry } from "../lib/render.ts";
import { capture, render } from "../../test-mount.ts";
import Toc from "./Toc.svelte";

const heading = (over: Partial<HeadingEntry>): HeadingEntry => ({
  level: 2,
  slug: "intro",
  text: "Intro",
  blockId: "b1",
  ...over,
});

const twoHeadings = [
  heading({ slug: "intro", text: "Intro", blockId: "b1", level: 2 }),
  heading({ slug: "details", text: "Details", blockId: "b2", level: 3 }),
];

describe("Toc visibility (shouldShowRail)", () => {
  test("renders nothing with no headings", () => {
    const { target } = render(Toc, { headings: [], activeSlug: null, onJump: () => {} });
    expect(target.querySelector(".toc")).toBeNull();
  });

  test("renders nothing with a single heading (a one-tick rail is noise)", () => {
    const { target } = render(Toc, {
      headings: [heading({})],
      activeSlug: null,
      onJump: () => {},
    });
    expect(target.querySelector(".toc")).toBeNull();
  });

  test("renders the rail from two headings up", () => {
    const { target } = render(Toc, {
      headings: twoHeadings,
      activeSlug: null,
      onJump: () => {},
    });
    expect(target.querySelector(".toc")).not.toBeNull();
    expect(target.querySelectorAll(".marks .mark")).toHaveLength(2);
    expect(target.querySelectorAll(".links a")).toHaveLength(2);
  });
});

describe("Toc content wiring", () => {
  test("each link targets the heading's structural block id", () => {
    const { target } = render(Toc, {
      headings: twoHeadings,
      activeSlug: null,
      onJump: () => {},
    });
    const hrefs = [...target.querySelectorAll(".links a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["#b1", "#b2"]);
  });

  test("level drives the per-tick and per-link level class", () => {
    const { target } = render(Toc, {
      headings: twoHeadings,
      activeSlug: null,
      onJump: () => {},
    });
    expect(target.querySelector(".mark.lvl-2")).not.toBeNull();
    expect(target.querySelector(".mark.lvl-3")).not.toBeNull();
  });

  test("marks the active heading on both the tick and the link", () => {
    const { target } = render(Toc, {
      headings: twoHeadings,
      activeSlug: "details",
      onJump: () => {},
    });
    const activeTick = target.querySelectorAll(".marks .mark")[1]!;
    const activeLink = target.querySelectorAll(".links li")[1]!;
    expect(activeTick.classList.contains("active")).toBe(true);
    expect(activeLink.classList.contains("active")).toBe(true);
    expect(activeLink.querySelector("a")!.getAttribute("aria-current")).toBe("location");
  });

  test("a non-active link omits aria-current", () => {
    const { target } = render(Toc, {
      headings: twoHeadings,
      activeSlug: "details",
      onJump: () => {},
    });
    const inactive = target.querySelectorAll(".links a")[0]!;
    expect(inactive.getAttribute("aria-current")).toBeNull();
  });
});

describe("Toc jump callback", () => {
  test("clicking a tick jumps to its slug", () => {
    const jumped = capture<string>();
    const { target } = render(Toc, {
      headings: twoHeadings,
      activeSlug: null,
      onJump: jumped.cb,
    });
    (target.querySelectorAll(".marks .mark")[1] as HTMLElement).click();
    expect(jumped.last()).toBe("details");
  });

  test("clicking a panel link jumps to its slug (and preventDefault keeps the hash jump smooth)", () => {
    const jumped = capture<string>();
    const { target } = render(Toc, {
      headings: twoHeadings,
      activeSlug: null,
      onJump: jumped.cb,
    });
    const link = target.querySelectorAll(".links a")[0] as HTMLElement;
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(ev);
    expect(jumped.last()).toBe("intro");
    expect(ev.defaultPrevented).toBe(true);
  });
});
