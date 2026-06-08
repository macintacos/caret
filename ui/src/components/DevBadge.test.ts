import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { render } from "../../test-mount.ts";
import DevBadge from "./DevBadge.svelte";

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
});
