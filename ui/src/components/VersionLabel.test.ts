import "@ui/test-mount.ts";
import { describe, expect, test } from "bun:test";

import { render } from "@ui/test-mount.ts";
import VersionLabel from "@/components/VersionLabel.svelte";

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

  // The revision number is fixed-width via the .metric atom (mono + tabular
  // figures), so the pill holds the same width whether the digit count grows
  // (v9 → v11). happy-dom does no real layout, so the falsifiable proxy for
  // that width-stability is the atom's presence on both digit counts.
  test("carries the tabular .metric atom across digit counts", () => {
    for (const version of [9, 11]) {
      const { target } = render(VersionLabel, { version });
      const badge = target.querySelector(".version")!;
      expect(badge.classList.contains("metric")).toBe(true);
      expect(badge.textContent).toContain(`v${version}`);
    }
  });
});
