import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import type { ClientReview } from "@core/types";
import { capture, render } from "../../test-mount.ts";
import ReviewSwitcher from "./ReviewSwitcher.svelte";

const review = (id: string, title: string): ClientReview =>
  ({ id, title, cwd: `/home/u/proj/${id}` }) as ClientReview;

describe("ReviewSwitcher single review", () => {
  test("shows the active title with no count badge or chevron", () => {
    const { target } = render(ReviewSwitcher, {
      reviews: [review("r1", "Only plan")],
      activeId: "r1",
      onSelect: () => {},
    });
    expect(target.querySelector(".title")!.textContent).toBe("Only plan");
    expect(target.querySelector(".badge")).toBeNull();
    expect(target.querySelector(".chev")).toBeNull();
    expect(target.querySelector(".switcher")!.classList.contains("single")).toBe(true);
  });

  test("clicking does not open a menu when there is only one review", () => {
    const { target, flush } = render(ReviewSwitcher, {
      reviews: [review("r1", "Only plan")],
      activeId: "r1",
      onSelect: () => {},
    });
    (target.querySelector(".current") as HTMLElement).click();
    flush();
    expect(target.querySelector(".menu")).toBeNull();
  });

  test("dashes the title when no review matches the active id", () => {
    const { target } = render(ReviewSwitcher, {
      reviews: [review("r1", "Plan")],
      activeId: "missing",
      onSelect: () => {},
    });
    expect(target.querySelector(".title")!.textContent).toBe("—");
  });
});

describe("ReviewSwitcher multiple reviews", () => {
  const reviews = [review("r1", "First"), review("r2", "Second"), review("r3", "Third")];

  test("shows the count badge and chevron", () => {
    const { target } = render(ReviewSwitcher, {
      reviews,
      activeId: "r1",
      onSelect: () => {},
    });
    expect(target.querySelector(".badge")!.textContent).toBe("3");
    expect(target.querySelector(".chev")).not.toBeNull();
  });

  // The count pill carries the .metric atom (mono + tabular figures), so a
  // 9 → 11 jump in review count does not reflow its width. happy-dom does no
  // real layout, so the falsifiable proxy is the atom's presence on both counts.
  test("count badge carries the tabular .metric atom across digit counts", () => {
    for (const n of [9, 11]) {
      const many = Array.from({ length: n }, (_, i) => review(`r${i}`, `Plan ${i}`));
      const { target } = render(ReviewSwitcher, {
        reviews: many,
        activeId: "r0",
        onSelect: () => {},
      });
      const badge = target.querySelector(".badge")!;
      expect(badge.classList.contains("metric")).toBe(true);
      expect(badge.textContent).toBe(String(n));
    }
  });

  test("toggles the listbox open and closed", () => {
    const { target, flush } = render(ReviewSwitcher, {
      reviews,
      activeId: "r1",
      onSelect: () => {},
    });
    const current = target.querySelector(".current") as HTMLElement;
    current.click();
    flush();
    expect(target.querySelector(".menu")).not.toBeNull();
    expect(target.querySelector(".menu")!.querySelectorAll("li")).toHaveLength(3);
    current.click();
    flush();
    expect(target.querySelector(".menu")).toBeNull();
  });

  test("marks the active option as selected", () => {
    const { target, flush } = render(ReviewSwitcher, {
      reviews,
      activeId: "r2",
      onSelect: () => {},
    });
    (target.querySelector(".current") as HTMLElement).click();
    flush();
    const selected = target.querySelector('[aria-selected="true"]')!;
    expect(selected.querySelector(".m-title")!.textContent).toBe("Second");
  });

  test("picking an option fires onSelect and closes the menu", () => {
    const picked = capture<string>();
    const { target, flush } = render(ReviewSwitcher, {
      reviews,
      activeId: "r1",
      onSelect: picked.cb,
    });
    (target.querySelector(".current") as HTMLElement).click();
    flush();
    const options = target.querySelectorAll('[role="option"]');
    (options[2] as HTMLElement).click();
    flush();
    expect(picked.last()).toBe("r3");
    expect(target.querySelector(".menu")).toBeNull();
  });

  test("abbreviates each option's cwd", () => {
    const { target, flush } = render(ReviewSwitcher, {
      reviews,
      activeId: "r1",
      onSelect: () => {},
    });
    (target.querySelector(".current") as HTMLElement).click();
    flush();
    // shortCwd collapses a deep path to …/<parent>/<leaf>.
    expect(target.querySelector(".m-meta")!.textContent).toBe("…/proj/r1");
  });
});

describe("ReviewSwitcher strips markdown links from titles", () => {
  const linked = "Triage analysis to post — [EXC-562](https://linear.app/macintacos/issue/EXC-562)";
  const stripped = "Triage analysis to post — EXC-562";

  test("shows the active title's link text in the pill", () => {
    const { target } = render(ReviewSwitcher, {
      reviews: [review("r1", linked)],
      activeId: "r1",
      onSelect: () => {},
    });
    expect(target.querySelector(".title")!.textContent).toBe(stripped);
  });

  test("shows each option's link text in the dropdown", () => {
    const { target, flush } = render(ReviewSwitcher, {
      reviews: [review("r1", linked), review("r2", "Second")],
      activeId: "r1",
      onSelect: () => {},
    });
    (target.querySelector(".current") as HTMLElement).click();
    flush();
    expect(target.querySelector(".m-title")!.textContent).toBe(stripped);
  });
});
