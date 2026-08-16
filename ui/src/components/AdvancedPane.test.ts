import "@ui/test-mount.ts";
import { describe, expect, test } from "bun:test";

import type { DaemonDiagnostics, HealthIdentity } from "@core/lib/types";
import { capture, flushUntil, render } from "@ui/test-mount.ts";
import AdvancedPane from "@/components/AdvancedPane.svelte";

// The Advanced diagnostics pane (EXC-848): a read-only, copyable view of the
// running build (from /api/health), daemon liveness + system + parsed config
// (from /api/diagnostics). Both fetches are injected here so the render, the
// per-block copy wiring, and the per-block degrade are deterministic without a
// daemon. The formatters themselves are covered in diagnostics.test.ts.

const health: HealthIdentity = {
  service: "caret",
  version: "0.7.0",
  build: "2f81c3a",
  commit: "8c5d84a9f0e1",
  isDev: false,
};

const diagnostics: DaemonDiagnostics = {
  system: { platform: "darwin", arch: "arm64", runtime: "bun 1.2.19" },
  uptimeMs: 2 * 3_600_000 + 14 * 60_000,
  settings: { daemon: { port: 42718 }, review: { timeout_s: 3600 } },
  config: { path: "/Users/x/.config/caret/config.toml", exists: true, env: [] },
};

const textOf = (target: HTMLElement, key: string): string =>
  target.querySelector(`[data-diag="${key}"] .diag-text`)?.textContent ?? "";
const copyBtn = (target: HTMLElement, key: string): HTMLElement | null =>
  target.querySelector(`[data-diag="${key}"] .diag-copy`);

describe("AdvancedPane render", () => {
  test("renders version, daemon, system, and config from health + diagnostics", async () => {
    const { target, flush } = render(AdvancedPane, {
      onCopyDiagnostic: () => {},
      loadHealth: () => Promise.resolve(health),
      loadDiagnostics: () => Promise.resolve(diagnostics),
    });

    await flushUntil(flush, () => textOf(target, "version").includes("0.7.0"));

    expect(textOf(target, "version")).toBe("caret 0.7.0 · build 2f81c3a · commit 8c5d84a");
    expect(textOf(target, "daemon")).toBe("live · port 42718 · up 2h 14m");
    expect(textOf(target, "system")).toBe("darwin (arm64) · bun 1.2.19");
    expect(textOf(target, "config")).toContain("[daemon]");
    expect(textOf(target, "config")).toContain("port = 42718");

    // The config file path sits above its block.
    expect(target.querySelector('[data-diag="config"] .diag-path')?.textContent).toBe(
      "/Users/x/.config/caret/config.toml",
    );
    // The daemon block leads with a lit live dot.
    expect(target.querySelector('[data-diag="daemon"] .diag-dot')?.getAttribute("data-live")).toBe(
      "true",
    );
  });

  // EXC-1112: the blocks title rather than label — they name no control — and each
  // field is named by its own title rather than left a nameless grouping boundary.
  test("each diagnostics block is a named field, titled rather than labelled", async () => {
    const { target, flush } = render(AdvancedPane, {
      onCopyDiagnostic: () => {},
      loadHealth: () => Promise.resolve(health),
      loadDiagnostics: () => Promise.resolve(diagnostics),
    });

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
    const { target, flush } = render(AdvancedPane, {
      onCopyDiagnostic: () => {},
      loadHealth: () => Promise.resolve(health),
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
  test("Copy and the block itself both call onCopyDiagnostic with the block's exact text", async () => {
    const cap = capture<string>();
    const { target, flush } = render(AdvancedPane, {
      onCopyDiagnostic: cap.cb,
      loadHealth: () => Promise.resolve(health),
      loadDiagnostics: () => Promise.resolve(diagnostics),
    });

    await flushUntil(flush, () => copyBtn(target, "version") !== null);

    copyBtn(target, "version")!.click();
    expect(cap.last()).toBe("caret 0.7.0 · build 2f81c3a · commit 8c5d84a");

    // Clicking the sunk block copies the same text (the "click a block to copy" affordance).
    (target.querySelector('[data-diag="daemon"] .diag-block') as HTMLElement).click();
    expect(cap.last()).toBe("live · port 42718 · up 2h 14m");

    copyBtn(target, "config")!.click();
    expect(cap.last()).toContain("port = 42718");
  });
});
