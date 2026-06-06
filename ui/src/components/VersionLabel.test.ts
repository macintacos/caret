import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { render } from "../../test-mount.ts";
import VersionLabel from "./VersionLabel.svelte";

describe("VersionLabel", () => {
  test("renders nothing for the first version", () => {
    const { target } = render(VersionLabel, { version: 1 });
    expect(target.querySelector(".version")).toBeNull();
  });

  test("renders the badge for a revised plan", () => {
    const { target } = render(VersionLabel, { version: 3 });
    const badge = target.querySelector(".version");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("v3");
    expect(badge!.getAttribute("title")).toBe("Revision 3 of this plan");
  });

  test("keeps the ^ brand glyph in the badge", () => {
    const { target } = render(VersionLabel, { version: 2 });
    expect(target.querySelector(".caret")!.textContent).toBe("^");
  });
});
