import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import type { FileRefKind } from "@core/lib/types";
import { render } from "@ui/support/mount.ts";
import { reactiveProps } from "@ui/support/props.svelte.ts";
import RefHintBadge from "@/components/RefHintBadge.svelte";

// RefHintBadge is the one-time teaching dot over a clickable path token (EXC-1061).
// These units cover the contract DiffPlanView depends on: it anchors itself at the
// given content coordinates, its copy follows the reference kind, both stay reactive,
// and activating it opens the reference without waking the line-comment composer on
// the row beneath. The attention ring is a CSS animation — happy-dom neither lays out
// nor animates, so the ping is unasserted anywhere: its reduced-motion collapse is a
// property of the global guard (pinned in motion.test.ts), and the wave itself is
// decoration with no behaviour to hang an assertion on.

const badge = (target: HTMLElement): HTMLButtonElement =>
  target.querySelector("button.ref-hint") as HTMLButtonElement;

describe("RefHintBadge", () => {
  test("anchors itself at the given content coordinates", () => {
    const { target, flush } = render(RefHintBadge, {
      kind: "file",
      path: "src/cache.ts",
      top: 12,
      left: 34,
      onActivate: () => {},
    });
    flush();
    expect(badge(target).style.top).toBe("12px");
    expect(badge(target).style.left).toBe("34px");
  });

  test("teaches the preview gesture on a file reference", () => {
    const { target, flush } = render(RefHintBadge, {
      kind: "file",
      path: "src/cache.ts",
      top: 0,
      left: 0,
      onActivate: () => {},
    });
    flush();
    expect(badge(target).getAttribute("aria-label")).toBe("Preview this file");
  });

  test("teaches the browse gesture on a directory reference", () => {
    const { target, flush } = render(RefHintBadge, {
      kind: "directory",
      path: "src/lib",
      top: 0,
      left: 0,
      onActivate: () => {},
    });
    flush();
    expect(badge(target).getAttribute("aria-label")).toBe("Browse this folder");
  });

  test("re-anchors and re-labels when its props change", () => {
    const props = reactiveProps({
      kind: "file" as FileRefKind,
      path: "src/cache.ts",
      top: 4,
      left: 8,
      onActivate: () => {},
    });
    const { target, flush } = render(RefHintBadge, props);
    flush();

    props.kind = "directory";
    props.path = "src/lib";
    props.top = 40;
    props.left = 80;
    flush();

    expect(badge(target).style.top).toBe("40px");
    expect(badge(target).style.left).toBe("80px");
    expect(badge(target).getAttribute("aria-label")).toBe("Browse this folder");
  });

  test("names the path in the description rather than in the accessible name", () => {
    // The name stays stable so it is not fixture data for a locator, and the path
    // rides the tooltip — which bits-ui points aria-describedby at. A name equal to
    // the description would be announced twice, and "this file" has no antecedent
    // in the accessibility tree: the token is a shadow-root span with no role.
    const { target, flush } = render(RefHintBadge, {
      kind: "file",
      path: "src/cache.ts",
      top: 0,
      left: 0,
      onActivate: () => {},
    });
    flush();
    const label = badge(target).getAttribute("aria-label") ?? "";
    expect(label).toBe("Preview this file");
    expect(label).not.toContain("src/cache.ts");
  });

  test("opens the reference when clicked", () => {
    let opened = 0;
    const { target, flush } = render(RefHintBadge, {
      kind: "file",
      path: "src/cache.ts",
      top: 0,
      left: 0,
      onActivate: () => {
        opened += 1;
      },
    });
    flush();
    badge(target).click();

    expect(opened).toBe(1);
  });

  test("keeps its click off the plan surface beneath", () => {
    // The badge floats over a code row; a click that reached .diff-plan would open the
    // line-comment composer on the line the reviewer is only being taught about. The
    // observer is document.body rather than the mount target because svelte delegates
    // click to the mount root: a native listener on the target itself runs alongside
    // the delegated dispatch, not downstream of it, so it would see the event whatever
    // the handler did. Anything above the root is genuinely downstream.
    let beneath = 0;
    const listener = () => {
      beneath += 1;
    };
    const { target, flush } = render(RefHintBadge, {
      kind: "file",
      path: "src/cache.ts",
      top: 0,
      left: 0,
      onActivate: () => {},
    });
    flush();
    document.body.addEventListener("click", listener);
    badge(target).click();
    document.body.removeEventListener("click", listener);

    expect(beneath).toBe(0);
  });
});
