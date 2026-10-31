import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import type { DaemonDiagnostics, HealthIdentity } from "@core/lib/types";
import { fakeDiagnostics } from "@test/support/diagnostics.ts";
import { flushUntil, render } from "@ui/support/mount.ts";
import AdvancedPane from "@/components/AdvancedPane.svelte";

// The Advanced diagnostics pane (EXC-848): a read-only, copyable view of the
// running build (from /api/health), daemon liveness + system + parsed config
// (from /api/diagnostics). Both fetches and the clipboard are injected here so the
// render, the per-block copy wiring, and the per-block degrade are deterministic
// without a daemon. The formatters themselves are covered in diagnostics.test.ts, the
// copy cap's confirmation in CodeChromeTray.test.ts, and the wrap cap's overflow gate,
// which needs layout, in advanced.e2e.ts.

const health: HealthIdentity = {
  service: "caret",
  version: "0.7.0",
  build: "2f81c3a",
  commit: "8c5d84a9f0e1",
  isDev: false,
};

const diagnostics = fakeDiagnostics();

const textOf = (target: HTMLElement, key: string): string =>
  target.querySelector(`[data-diag="${key}"] .diag-text`)?.textContent ?? "";
const copyBtn = (target: HTMLElement, key: string): HTMLElement | null =>
  target.querySelector(`[data-diag="${key}"] button.code-copy`);

function renderPane(
  over: {
    loadDiagnostics?: () => Promise<DaemonDiagnostics>;
    copy?: (text: string) => Promise<void>;
  } = {},
): { target: HTMLElement; flush: () => void } {
  return render(AdvancedPane, {
    copy: over.copy ?? (() => Promise.resolve()),
    loadHealth: () => Promise.resolve(health),
    loadDiagnostics: over.loadDiagnostics ?? (() => Promise.resolve(diagnostics)),
  });
}

describe("AdvancedPane render", () => {
  test("renders version, daemon, system, and config from health + diagnostics", async () => {
    const { target, flush } = renderPane();

    await flushUntil(flush, () => textOf(target, "version").includes("0.7.0"));

    expect(textOf(target, "version")).toBe("caret 0.7.0 · build 2f81c3a · commit 8c5d84a");
    expect(textOf(target, "daemon")).toBe("live · port 42718 · up 2h 14m");
    expect(textOf(target, "system")).toBe("darwin (arm64) · bun 0.0.0");
    expect(textOf(target, "config")).toContain("[daemon]");
    expect(textOf(target, "config")).toContain("port = 42718");

    // The config file path sits above its block.
    expect(target.querySelector('[data-diag="config"] .diag-path')?.textContent).toBe(
      diagnostics.config.path,
    );
    // The daemon block leads with a lit live dot.
    expect(target.querySelector('[data-diag="daemon"] .diag-dot')?.getAttribute("data-live")).toBe(
      "true",
    );
  });

  // EXC-1112: the blocks title rather than label — they name no control — and each
  // field is named by its own title rather than left a nameless grouping boundary.
  test("each diagnostics block is a named field, titled rather than labelled", async () => {
    const { target, flush } = renderPane();

    await flushUntil(flush, () => textOf(target, "version").includes("0.7.0"));

    expect(target.querySelector("[data-advanced-pane] [data-slot='field-group']") !== null).toBe(
      true,
    );
    const fields = [...target.querySelectorAll("[data-slot='field']")];
    expect(fields.length).toBe(target.querySelectorAll("[data-diag]").length);
    for (const field of fields) {
      const title = field.querySelector(".diag-label");
      expect(title?.tagName).toBe("DIV");
      const titleId = title?.id ?? "";
      expect(titleId).not.toBe("");
      expect(field.getAttribute("aria-labelledby")).toBe(titleId);
    }
  });
});

describe("AdvancedPane per-block degrade", () => {
  test("daemon/system/config degrade when diagnostics fails; version survives", async () => {
    const { target, flush } = renderPane({
      loadDiagnostics: () => Promise.reject(new Error("offline")),
    });

    await flushUntil(flush, () => textOf(target, "version").includes("0.7.0"));

    // Health-sourced, so it still renders when the diagnostics fetch fails.
    expect(textOf(target, "version")).toContain("caret 0.7.0");
    // Diagnostics-sourced blocks degrade per-block to a placeholder.
    expect(textOf(target, "daemon")).toBe("Unavailable");
    expect(textOf(target, "system")).toBe("Unavailable");
    expect(textOf(target, "config")).toBe("Unavailable");
    // The live dot is muted and a degraded block offers no copy affordance.
    expect(target.querySelector('[data-diag="daemon"] .diag-dot')?.getAttribute("data-live")).toBe(
      "false",
    );
    expect(copyBtn(target, "system") === null).toBe(true);
  });
});

describe("AdvancedPane copy", () => {
  test("each block's copy cap writes that block's exact text, named for the block", async () => {
    const written: string[] = [];
    const { target, flush } = renderPane({
      copy: (text) => {
        written.push(text);
        return Promise.resolve();
      },
    });

    await flushUntil(flush, () => copyBtn(target, "config") !== null);

    expect(copyBtn(target, "version")?.getAttribute("aria-label")).toBe("Copy Version");
    copyBtn(target, "version")!.click();
    copyBtn(target, "daemon")!.click();
    copyBtn(target, "config")!.click();
    await flushUntil(flush, () => written.length === 3);

    expect(written[0]).toBe("caret 0.7.0 · build 2f81c3a · commit 8c5d84a");
    expect(written[1]).toBe("live · port 42718 · up 2h 14m");
    expect(written[2]).toContain("port = 42718");
  });
});
