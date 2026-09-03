import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import type { UpdateReport, UpdateStatus } from "@core/lib/types";
import { render } from "@ui/support/mount.ts";
import UpdatesPane from "@/components/UpdatesPane.svelte";

// The settings Updates pane (EXC-1207): the read-only half of the category — what the
// daemon's cached verdict says, and the command that takes the upgrade. The report is a
// PROP rather than a fetch of its own (unlike AdvancedPane), because App needs the same
// report for the toast and the two badges and a second fetch would be a second truth.
//
// The verdict→copy mapping itself is pure and covered in lib/updates.test.ts; this suite
// covers what the component does with it — the rendered blocks, the command's presence,
// the dot's tone, and the null-report degrade.

const report = (status: UpdateStatus, version = "1.4.0"): UpdateReport => ({
  install: "binary",
  version,
  commit: "abc1234",
  checkEnabled: true,
  status,
});

const RELEASE: UpdateStatus = {
  kind: "behind-release",
  available: "1.5.0",
  command: "bunx --no-cache @macintacos/caret@latest install --refresh",
};
const COMMIT: UpdateStatus = {
  kind: "behind-commit",
  aheadBy: 3,
  command: "mise run build --install",
};

const text = (target: HTMLElement, sel: string): string =>
  target.querySelector(sel)?.textContent?.trim() ?? "";
const tone = (target: HTMLElement): string | null =>
  target.querySelector(".update-dot")?.getAttribute("data-tone") ?? null;

describe("UpdatesPane render", () => {
  test("a newer release shows the available version, what is running, and the command", () => {
    const { target } = render(UpdatesPane, { report: report(RELEASE) });
    expect(text(target, ".update-headline")).toContain("1.5.0");
    expect(text(target, ".update-detail")).toContain("1.4.0");
    expect(text(target, ".update-command")).toBe(RELEASE.command);
  });

  test("a commit verdict shows the distance and its own rebuild command", () => {
    const { target } = render(UpdatesPane, { report: report(COMMIT) });
    expect(text(target, ".update-headline")).toContain("3 commits");
    expect(text(target, ".update-command")).toBe(COMMIT.command);
  });

  test("an up-to-date caret renders no command block", () => {
    const { target } = render(UpdatesPane, { report: report({ kind: "current" }) });
    expect(text(target, ".update-headline")).toBeTruthy();
    // Boolean assertion (never `.toBeNull()` — a live happy-dom node serializes
    // circularly and hangs bun on failure).
    expect(target.querySelector(".update-command") === null).toBe(true);
  });

  test("the two off states and the unknown verdict render copy but no command", () => {
    for (const status of [
      { kind: "unavailable", reason: "dev" },
      { kind: "unavailable", reason: "disabled" },
      { kind: "unknown", reason: "could not compare this build against trunk" },
    ] as UpdateStatus[]) {
      const { target } = render(UpdatesPane, { report: report(status) });
      expect(text(target, ".update-headline"), status.kind).toBeTruthy();
      expect(text(target, ".update-detail"), status.kind).toBeTruthy();
      expect(target.querySelector(".update-command") === null, status.kind).toBe(true);
    }
  });

  test("the dot's tone follows the verdict, so it reads before the sentence does", () => {
    // --attention is the novelty job ("worth a glance"), --ok the positive semantic, and
    // a quiet verdict stays neutral. Amber is not spent here — it marks selection.
    expect(tone(render(UpdatesPane, { report: report(RELEASE) }).target)).toBe("pending");
    expect(tone(render(UpdatesPane, { report: report(COMMIT) }).target)).toBe("pending");
    expect(tone(render(UpdatesPane, { report: report({ kind: "current" }) }).target)).toBe("ok");
    expect(
      tone(render(UpdatesPane, { report: report({ kind: "unknown", reason: "x" }) }).target),
    ).toBe("quiet");
  });

  test("a null report degrades to a quiet placeholder, never an error", () => {
    // The fetch failed, or the daemon wires no update thunk at all. Per AdvancedPane's
    // per-block degrade: say there is nothing to show, don't shout.
    const { target } = render(UpdatesPane, { report: null });
    expect(target.querySelector("[data-updates-pane]") === null).toBe(false);
    expect(text(target, ".update-placeholder")).toBeTruthy();
    expect(target.querySelector(".update-command") === null).toBe(true);
    expect(target.textContent?.toLowerCase()).not.toContain("error");
  });
});
