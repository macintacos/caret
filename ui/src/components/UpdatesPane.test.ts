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
const commandInput = (target: HTMLElement): HTMLInputElement | null =>
  target.querySelector<HTMLInputElement>("input.update-command");
const tone = (target: HTMLElement): string | null =>
  target.querySelector(".update-dot")?.getAttribute("data-tone") ?? null;

describe("UpdatesPane render", () => {
  test("a newer release shows the available version, what is running, and the command", () => {
    const { target } = render(UpdatesPane, { report: report(RELEASE) });
    expect(text(target, ".update-headline")).toContain("1.5.0");
    expect(text(target, ".update-detail")).toContain("1.4.0");
    expect(commandInput(target)?.value).toBe(RELEASE.command);
    expect(commandInput(target)?.readOnly).toBe(true);
  });

  test("a commit verdict shows the distance and its own rebuild command", () => {
    const { target } = render(UpdatesPane, { report: report(COMMIT) });
    expect(text(target, ".update-headline")).toContain("3 commits");
    expect(commandInput(target)?.value).toBe(COMMIT.command);
  });

  test("an up-to-date caret renders no command field", () => {
    const { target } = render(UpdatesPane, { report: report({ kind: "current" }) });
    expect(text(target, ".update-headline")).toBeTruthy();
    // Boolean assertion (never `.toBeNull()` — a live happy-dom node serializes
    // circularly and hangs bun on failure).
    expect(commandInput(target) === null).toBe(true);
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
      expect(commandInput(target) === null, status.kind).toBe(true);
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
    expect(commandInput(target) === null).toBe(true);
    expect(target.textContent?.toLowerCase()).not.toContain("error");
  });

  test("a behind verdict offers a What's new button that calls onWhatsNew", () => {
    for (const status of [RELEASE, COMMIT]) {
      let calls = 0;
      const { target } = render(UpdatesPane, {
        report: report(status),
        onWhatsNew: () => calls++,
      });
      const button = target.querySelector<HTMLButtonElement>("[data-whats-new]");
      expect(button === null, status.kind).toBe(false);
      button?.click();
      expect(calls, status.kind).toBe(1);
    }
  });

  test("a verdict with nothing new offers no What's new button", () => {
    for (const status of [
      { kind: "current" },
      { kind: "unavailable", reason: "dev" },
      { kind: "unknown", reason: "x" },
    ] as UpdateStatus[]) {
      const { target } = render(UpdatesPane, { report: report(status) });
      expect(target.querySelector("[data-whats-new]") === null, status.kind).toBe(true);
    }
  });
});
