import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import type { ClientReview } from "@core/lib/types";
import { render } from "@ui/support/mount.ts";
import ReviewSwitcher from "@/components/ReviewSwitcher.svelte";

// EXC-760: ReviewSwitcher is now a shadcn DropdownMenu. Its trigger (active
// title + count Badge + chevron) and the inert single-review label render
// synchronously and are unit-asserted here. The menu itself — opening, the
// option list, active marking, and picking — is bits-ui overlay interaction
// (portalled, pointer/keyboard driven), so it lives in
// test/e2e/review-switcher.e2e.ts per doc/agents/browser-testing.md.

const review = (id: string, title: string): ClientReview =>
  ({ id, title, cwd: `/home/u/proj/${id}` }) as ClientReview;

function mountSwitcher(
  over: Partial<{
    reviews: ClientReview[];
    activeId: string;
    unread: string[];
    arrivals: number;
    onSelect: (id: string) => void;
  }> = {},
): ReturnType<typeof render> {
  return render(ReviewSwitcher, {
    reviews: [review("r1", "Only plan")],
    activeId: "r1",
    unread: [],
    arrivals: 0,
    onSelect: () => {},
    ...over,
  });
}

describe("ReviewSwitcher single review", () => {
  test("shows the active title as an inert label with no count or chevron", () => {
    const { target } = mountSwitcher();
    expect(target.querySelector(".title")!.textContent).toBe("Only plan");
    expect(target.querySelector(".count")).toBeNull();
    expect(target.querySelector(".chev")).toBeNull();
    expect(target.querySelector(".switcher")!.classList.contains("single")).toBe(true);
  });

  test("renders no dropdown trigger when there is only one review", () => {
    const { target } = mountSwitcher();
    expect(target.querySelector("[data-slot='dropdown-menu-trigger']")).toBeNull();
    expect(target.querySelector(".switcher-trigger")).toBeNull();
  });

  test("dashes the title when no review matches the active id", () => {
    const { target } = mountSwitcher({ reviews: [review("r1", "Plan")], activeId: "missing" });
    expect(target.querySelector(".title")!.textContent).toBe("—");
  });
});

describe("ReviewSwitcher multiple reviews", () => {
  const reviews = [review("r1", "First"), review("r2", "Second"), review("r3", "Third")];

  test("renders a dropdown trigger carrying the active title", () => {
    const { target } = mountSwitcher({ reviews, activeId: "r2" });
    expect(target.querySelector(".switcher-trigger")).not.toBeNull();
    expect(target.querySelector(".title")!.textContent).toBe("Second");
    expect(target.querySelector(".chev")).not.toBeNull();
  });

  test("shows the review count in the trigger badge", () => {
    const { target } = mountSwitcher({ reviews });
    expect(target.querySelector(".count")!.textContent).toBe("3");
  });

  // The count carries the .metric atom (mono + tabular figures), so a 9 → 11
  // jump in review count does not reflow its width. happy-dom does no real
  // layout, so the falsifiable proxy is the atom's presence on both counts.
  test("count badge carries the tabular .metric atom across digit counts", () => {
    for (const n of [9, 11]) {
      const many = Array.from({ length: n }, (_, i) => review(`r${i}`, `Plan ${i}`));
      const { target } = mountSwitcher({ reviews: many, activeId: "r0" });
      const badge = target.querySelector(".count")!;
      expect(badge.classList.contains("metric")).toBe(true);
      expect(badge.textContent).toBe(String(n));
    }
  });
});

describe("ReviewSwitcher unread marker (EXC-411)", () => {
  // EXC-411: a plan that arrives or gains a version while another is being read
  // is marked unread, and the trigger carries a dot for it. The dropdown's own
  // per-row markers are portalled bits-ui content, so they are proven in
  // test/e2e/unread-markers.e2e.ts per doc/agents/browser-testing.md.
  const reviews = [review("r1", "First"), review("r2", "Second")];

  test("shows the trigger dot when a review is unread", () => {
    const { target } = mountSwitcher({ reviews, unread: ["r2"] });
    expect(target.querySelector(".unread-dot")).not.toBeNull();
  });

  test("shows no trigger dot when nothing is unread", () => {
    const { target } = mountSwitcher({ reviews });
    expect(target.querySelector(".unread-dot")).toBeNull();
  });

  // The dot is aria-hidden, so the tally has to ride the trigger's accessible
  // description — the same hidden span the pending count already uses.
  test("folds the unread tally into the trigger's accessible description", () => {
    const { target } = mountSwitcher({ reviews, unread: ["r2"] });
    expect(target.querySelector("#switcher-count")!.textContent).toBe(
      "2 reviews pending, 1 unread",
    );
  });

  test("describes only the pending count when nothing is unread", () => {
    const { target } = mountSwitcher({ reviews });
    expect(target.querySelector("#switcher-count")!.textContent).toBe("2 reviews pending");
  });

  test("renders no dot on the inert single-review label", () => {
    const { target } = mountSwitcher({ unread: ["r1"] });
    expect(target.querySelector(".unread-dot")).toBeNull();
  });
});

describe("ReviewSwitcher strips markdown links from the trigger title", () => {
  const linked = "Triage analysis to post — [EXC-562](https://linear.app/macintacos/issue/EXC-562)";
  const stripped = "Triage analysis to post — EXC-562";

  test("shows the active title's link text on the single-review label", () => {
    const { target } = mountSwitcher({ reviews: [review("r1", linked)] });
    expect(target.querySelector(".title")!.textContent).toBe(stripped);
  });

  test("shows the active title's link text on the dropdown trigger", () => {
    const { target } = mountSwitcher({ reviews: [review("r1", linked), review("r2", "Second")] });
    expect(target.querySelector(".title")!.textContent).toBe(stripped);
  });
});
