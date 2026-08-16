import "@ui/test-mount.ts";

import { describe, expect, test } from "bun:test";

import { Spinner } from "$lib/components/ui/spinner/index.js";

import { flushUntil, render } from "@ui/test-mount.ts";

// Composition guard for the vendored spinner (EXC-1109). Spinner is a plain
// (non-bits-ui, non-portalled) element, so it gets its suite beside it rather
// than a lib/shadcn-*.test.ts fixture — the placement doc/agents/shadcn-rules.md
// § Where the test goes prescribes, and the shape switch.test.ts already uses.
//
// The assertions that matter here are the ones a type-check cannot make: that
// the @lucide/svelte → Icon.svelte swap actually renders a glyph, that the
// wrapper caret introduced still carries the status role and its accessible
// name, and that `class` merges rather than replaces. Nothing composes Spinner
// yet, so this suite is its only consumer until EXC-1114.
const root = (target: HTMLElement) => target.querySelector("[data-slot='spinner']");

describe("Spinner", () => {
  test("renders a status element with an accessible name", async () => {
    const { target, flush } = render(Spinner, {});
    await flushUntil(flush, () => root(target) !== null);

    expect(root(target)?.getAttribute("role")).toBe("status");
    expect(root(target)?.getAttribute("aria-label")).toBe("Loading");
  });

  // The swap: stock imports @lucide/svelte/icons/loader-2, which caret does not
  // depend on. `data-icon` is what Icon.svelte stamps and the only thing in the
  // DOM that names an inlined glyph.
  test("renders the vendored loader-circle glyph, not a lucide component", async () => {
    const { target, flush } = render(Spinner, {});
    await flushUntil(flush, () => root(target) !== null);

    expect(root(target)?.querySelector("[data-icon='loader-circle']")).not.toBeNull();
    expect(root(target)?.querySelectorAll("svg").length).toBe(1);
  });

  // Decorative inside its labelled wrapper: the name is announced once, by the
  // status element, not twice.
  test("hides the glyph from the accessibility tree", async () => {
    const { target, flush } = render(Spinner, {});
    await flushUntil(flush, () => root(target) !== null);

    expect(root(target)?.querySelector("[data-icon]")?.getAttribute("aria-hidden")).toBe("true");
  });

  test("merges a caller's class instead of replacing the spin", async () => {
    const { target, flush } = render(Spinner, { class: "text-muted-foreground" });
    await flushUntil(flush, () => root(target) !== null);

    expect(root(target)?.classList.contains("text-muted-foreground")).toBe(true);
    expect(root(target)?.classList.contains("animate-spin")).toBe(true);
  });

  // Icon writes its dimensions inline, so a `size-*` utility in `class` cannot
  // resize the glyph — `size` is the prop that does, and a caller reaching for a
  // bigger spinner has to find it working.
  test("forwards size to the glyph", async () => {
    const { target, flush } = render(Spinner, { size: 24 });
    await flushUntil(flush, () => root(target) !== null);

    const glyph = root(target)?.querySelector("[data-icon='loader-circle']") as HTMLElement | null;
    expect(glyph?.style.width).toBe("24px");
    expect(glyph?.style.height).toBe("24px");
  });
});
