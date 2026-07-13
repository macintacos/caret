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
  });

  // EXC-763: the build/commit hint moved from a native title= to a shadcn
  // Tooltip (matching the TopBar cwd tooltip), so the button is a tooltip
  // trigger and carries no native title. The tooltip *content* is bits-ui
  // overlay (portalled, deferred under happy-dom), a visual/e2e concern.
  test("surfaces the build hint via a shadcn Tooltip, not a native title", () => {
    const { target } = render(VersionBadge, { version: "0.0.4", commit: "111111222222" });
    const badge = target.querySelector(".version-badge")!;
    expect(badge.getAttribute("title")).toBeNull();
    expect(badge.getAttribute("data-slot")).toBe("tooltip-trigger");
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

// EXC-664: the pill is click-to-copy. Clicking it writes a debug block — version,
// the FULL commit (not the 6-char display tail), build type, page URL, user agent
// — to the clipboard and flashes a confirmation, so a reviewer filing a bug hands
// over the exact running build in one click.
describe("VersionBadge click-to-copy (EXC-664)", () => {
  // Stub the async Clipboard API; writeText is invoked synchronously inside the
  // click handler, so the recorded text is observable without awaiting.
  function stubClipboard(): string[] {
    const writes: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          writes.push(text);
          return Promise.resolve();
        },
      },
    });
    return writes;
  }

  test("copies the version, full commit, and release build type on click", () => {
    const writes = stubClipboard();
    const { target } = render(VersionBadge, {
      version: "0.0.4",
      commit: "111111222222",
      isDev: false,
    });
    target.querySelector<HTMLButtonElement>(".version-badge")!.click();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("0.0.4");
    // The full commit, not the truncated display tail.
    expect(writes[0]).toContain("111111222222");
    expect(writes[0]).toContain("release");
  });

  test("marks the build as local source when isDev is set", () => {
    const writes = stubClipboard();
    const { target } = render(VersionBadge, {
      version: "0.0.4",
      commit: "111111222222",
      isDev: true,
    });
    target.querySelector<HTMLButtonElement>(".version-badge")!.click();
    expect(writes[0]).toContain("local source");
  });

  test("flashes a copied confirmation on click", () => {
    stubClipboard();
    const { target, flush } = render(VersionBadge, {
      version: "0.0.4",
      commit: "111111222222",
      isDev: false,
    });
    const badge = target.querySelector<HTMLButtonElement>(".version-badge")!;
    badge.click();
    flush();
    expect(badge.classList.contains("copied")).toBe(true);
    expect(badge.textContent?.trim()).toBe("Copied");
  });
});
