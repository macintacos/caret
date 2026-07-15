import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";

import StatusStrip from "@/components/StatusStrip.svelte";

import { render } from "../../test-mount.ts";

// EXC-763: the StatusStrip readout is rebuilt on shadcn primitives (Badge for
// the revision pill, Separator for the metric dividers, Tooltip for the hover
// hints on the revision and connection). This suite covers the synchronous
// surface — the readout's numbers, gates, and connection state, plus the
// shadcn structure. The tooltip *content* is bits-ui overlay (portalled,
// deferred under happy-dom), so it is a visual/e2e concern, not asserted here —
// the same split TopBar.test.ts uses for its cwd tooltip.

const base = {
  active: true,
  pendingCount: 0,
  coveredLines: 0,
  version: 1,
  connected: true,
};

describe("StatusStrip", () => {
  test("self-gates: renders nothing when no review is active", () => {
    const { target } = render(StatusStrip, { ...base, active: false, pendingCount: 3 });
    expect(target.querySelector(".status-strip")).toBeNull();
  });

  test("active with comments: shows the pending tally and the .metric atom", () => {
    const { target } = render(StatusStrip, { ...base, pendingCount: 3, coveredLines: 5 });
    const strip = target.querySelector(".status-strip");
    expect(strip).not.toBeNull();
    expect(strip!.classList.contains("metric")).toBe(true);
    expect(strip!.querySelector(".num")!.textContent).toBe("3");
    expect(strip!.textContent).toContain("comments");
  });

  test("singular comment label when exactly one comment is pending", () => {
    const { target } = render(StatusStrip, { ...base, pendingCount: 1 });
    const strip = target.querySelector(".status-strip")!;
    expect(strip.textContent).toContain("comment");
    expect(strip.textContent).not.toContain("comments");
  });

  test("active with no comments still renders (revision + connection carry value)", () => {
    const { target } = render(StatusStrip, { ...base, pendingCount: 0 });
    const strip = target.querySelector(".status-strip");
    expect(strip).not.toBeNull();
    expect(strip!.querySelector(".num")!.textContent).toBe("0");
  });

  test("colors a populated pending tally semantically", () => {
    const populated = render(StatusStrip, { ...base, pendingCount: 2 });
    expect(populated.target.querySelector(".num")!.classList.contains("has")).toBe(true);

    const empty = render(StatusStrip, { ...base, pendingCount: 0 });
    expect(empty.target.querySelector(".num")!.classList.contains("has")).toBe(false);
  });

  test("shows the covered-lines tally only when there are line-covering comments", () => {
    const withCoverage = render(StatusStrip, { ...base, pendingCount: 2, coveredLines: 4 });
    expect(withCoverage.target.querySelector(".covered")!.textContent).toBe("4");

    // Comments exist but none anchor to source lines (e.g. legacy-only) → no
    // lines tally, just the comment count.
    const noCoverage = render(StatusStrip, { ...base, pendingCount: 2, coveredLines: 0 });
    expect(noCoverage.target.querySelector(".covered")).toBeNull();
  });

  test("shows the ^vN revision pill only past the first version", () => {
    const v2 = render(StatusStrip, { ...base, version: 2 });
    expect(v2.target.querySelector(".rev")!.textContent).toContain("v2");
    expect(v2.target.querySelector(".rev .caret")!.textContent).toBe("^");

    const v1 = render(StatusStrip, { ...base, version: 1 });
    expect(v1.target.querySelector(".rev")).toBeNull();
  });

  test("reflects the connection state once, with a semantic dot", () => {
    const online = render(StatusStrip, { ...base, connected: true });
    const onConn = online.target.querySelector(".conn")!;
    expect(onConn.classList.contains("offline")).toBe(false);
    expect(onConn.textContent).toContain("live");

    const offline = render(StatusStrip, { ...base, connected: false });
    const offConn = offline.target.querySelector(".conn")!;
    expect(offConn.classList.contains("offline")).toBe(true);
    expect(offConn.textContent).toContain("offline");
  });

  // EXC-763 shadcn structure ------------------------------------------------

  // The metric dividers are shadcn Separators, not the old `·` glyph spans —
  // the same vertical Separator the TopBar cluster uses, so the chrome shares
  // one divider vocabulary.
  test("divides the readout with shadcn Separators, not `·` glyphs", () => {
    const { target } = render(StatusStrip, {
      ...base,
      pendingCount: 2,
      coveredLines: 3,
      version: 2,
    });
    const strip = target.querySelector(".status-strip")!;
    const sep = strip.querySelector('[data-slot="separator"]');
    expect(sep).not.toBeNull();
    expect(strip.textContent).not.toContain("·");
    // Decorative, matching the old aria-hidden `·` glyphs — a screen reader
    // traversing the labelled strip shouldn't announce "separator" between metrics.
    expect(sep!.getAttribute("aria-hidden")).toBe("true");
  });

  // The revision pill is a shadcn Badge, reusing VersionLabel's amber-^ idiom,
  // so the ^vN marker reads identically whether it appears in the TopBar or the
  // status strip. It also drives a Tooltip, so bits-ui overwrites its own
  // data-slot to "tooltip-trigger" — the badge signature (the rounded-full pill
  // base from badgeVariants) is the stable proof the Badge component rendered it.
  test("renders the revision as a shadcn Badge", () => {
    const { target } = render(StatusStrip, { ...base, version: 2 });
    const rev = target.querySelector(".rev")!;
    expect(rev.classList.contains("rounded-full")).toBe(true);
    expect(rev.getAttribute("data-slot")).toBe("tooltip-trigger");
  });

  // EXC-763 follow-up: the comment tally is the toggle that opens the comment
  // navigator, so it must be a real button carrying its expanded state — not the
  // inert span it started as.
  test("renders the comment tally as a toggle button reflecting the open state", () => {
    const closed = render(StatusStrip, { ...base, pendingCount: 2, commentsOpen: false });
    const btn = closed.target.querySelector<HTMLButtonElement>("button.comments-toggle");
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("aria-expanded")).toBe("false");
    // The tally still lives inside the button.
    expect(btn!.querySelector(".num")!.textContent).toBe("2");

    const open = render(StatusStrip, { ...base, pendingCount: 2, commentsOpen: true });
    expect(open.target.querySelector("button.comments-toggle")!.getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  test("clicking the comment tally fires onToggleComments", () => {
    let toggled = 0;
    const { target } = render(StatusStrip, {
      ...base,
      pendingCount: 1,
      onToggleComments: () => {
        toggled += 1;
      },
    });
    target.querySelector<HTMLButtonElement>("button.comments-toggle")!.click();
    expect(toggled).toBe(1);
  });
});
