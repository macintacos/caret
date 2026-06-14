import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { render } from "../../test-mount.ts";
import VersionBadge from "./VersionBadge.svelte";

describe("VersionBadge", () => {
  test("renders the version with the last 6 chars of the commit", () => {
    // first 6 ("111111") differ from last 6 ("222222") so this proves the tail,
    // not the leading short hash, is shown.
    const { target } = render(VersionBadge, { version: "0.0.4", commit: "111111222222" });
    const badge = target.querySelector(".version-badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent?.trim()).toBe("v0.0.4-222222");
    // the hover tooltip spells out the version and the same 6-char commit
    expect(badge!.getAttribute("title")).toContain("commit 222222");
  });

  test("degrades to version-only when the commit is the 'unknown' sentinel", () => {
    const { target } = render(VersionBadge, { version: "0.0.4", commit: "unknown" });
    expect(target.querySelector(".version-badge")!.textContent?.trim()).toBe("v0.0.4");
  });

  test("degrades to version-only when the commit is absent", () => {
    const { target } = render(VersionBadge, { version: "0.0.4", commit: undefined });
    expect(target.querySelector(".version-badge")!.textContent?.trim()).toBe("v0.0.4");
  });

  test("renders nothing when the version is absent", () => {
    const { target } = render(VersionBadge, { version: undefined, commit: "111111222222" });
    expect(target.querySelector(".version-badge")).toBeNull();
  });

  // The build string is mono + tabular via the .metric atom, so the pill width
  // is stable as the version/commit digits change. Locks the treatment.
  test("carries the tabular .metric atom", () => {
    const { target } = render(VersionBadge, { version: "0.0.4", commit: "111111222222" });
    expect(target.querySelector(".version-badge")!.classList.contains("metric")).toBe(true);
  });
});
