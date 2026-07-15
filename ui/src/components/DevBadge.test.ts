import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";

import DevBadge from "@/components/DevBadge.svelte";

import { render } from "../../test-mount.ts";

describe("DevBadge", () => {
  test("renders nothing for a real (compiled) build", () => {
    const { target } = render(DevBadge, { isDev: false });
    expect(target.querySelector(".dev-badge")).toBeNull();
  });

  test("renders the local-build pill when isDev is set", () => {
    const { target } = render(DevBadge, { isDev: true });
    const badge = target.querySelector(".dev-badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("local build");
    expect(badge!.getAttribute("title")).toContain("local");
  });

  // Carries the .metric atom so it shares the numeric-chrome type policy with
  // its sibling badges (the pill row reads as one tabular system). Locks it.
  test("carries the .metric atom", () => {
    const { target } = render(DevBadge, { isDev: true });
    expect(target.querySelector(".dev-badge")!.classList.contains("metric")).toBe(true);
  });
});
