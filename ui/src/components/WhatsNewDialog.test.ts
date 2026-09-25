import "@ui/support/mount.ts";

import { describe, expect, test } from "bun:test";

import type { UpdateChanges, UpdateReport } from "@core/lib/types";
import { flushUntil, render } from "@ui/support/mount.ts";
import WhatsNewDialog from "@/components/WhatsNewDialog.svelte";

// bits-ui portals the dialog content to document.body on a deferred tick, so every
// assertion reads the body after an effect+timer flush.
const content = () => document.body.querySelector("[data-slot='dialog-content']");
const bodyText = () => content()?.textContent ?? "";
const anchors = () => [...(content()?.querySelectorAll("a") ?? [])];

const SHA = "0123456789abcdef0123456789abcdef01234567";
const RELEASE_COMMAND = "bunx --no-cache @macintacos/caret@latest install --refresh";
const BUNDLE: UpdateReport = {
  install: "bundle",
  version: "1.4.0",
  commit: SHA,
  checkEnabled: true,
  status: {
    kind: "behind-release",
    available: "1.5.0",
    command: RELEASE_COMMAND,
  },
};
const BINARY: UpdateReport = {
  ...BUNDLE,
  install: "binary",
  status: { kind: "behind-commit", aheadBy: 3, command: "mise run build --install" },
};

async function open(
  report: UpdateReport,
  load: () => Promise<UpdateChanges>,
  until: () => boolean,
): Promise<void> {
  const { flush } = render(WhatsNewDialog, {
    open: true,
    onClose: () => {},
    report,
    restartHint: "Then restart OpenCode.",
    load,
  });
  await flushUntil(flush, until);
}

describe("WhatsNewDialog", () => {
  test("shows a spinner while the changes load", async () => {
    await open(
      BUNDLE,
      () => new Promise(() => {}),
      () => content() !== null,
    );
    expect(content()?.querySelector("[data-slot='spinner']") !== null).toBe(true);
  });

  test("renders each release's heading and Markdown notes", async () => {
    const load = async (): Promise<UpdateChanges> => ({
      kind: "releases",
      releases: [
        { version: "1.5.0", body: "- **Bold** change" },
        { version: "1.4.1", body: "" },
      ],
    });
    await open(BUNDLE, load, () => bodyText().includes("caret 1.4.1"));
    expect(bodyText()).toContain("caret 1.5.0");
    expect(content()?.querySelector("strong")?.textContent).toBe("Bold");
  });

  test("strips body media and opens body links in a new tab", async () => {
    const load = async (): Promise<UpdateChanges> => ({
      kind: "releases",
      releases: [
        {
          version: "1.5.0",
          body: '![x](https://e.com/x.png) <video src="https://e.com/v.mp4"></video> <audio src="https://e.com/a.mp3"></audio> [docs](https://e.com/d)',
        },
      ],
    });
    await open(BUNDLE, load, () => bodyText().includes("docs"));
    expect(content()?.querySelector("img, video, audio") === null).toBe(true);
    const docs = anchors().find((a) => a.textContent === "docs");
    expect(docs?.getAttribute("target")).toBe("_blank");
    expect(docs?.getAttribute("rel")).toBe("noreferrer");
  });

  test("links commits that carry a PR and closes with the remainder", async () => {
    const load = async (): Promise<UpdateChanges> => ({
      kind: "commits",
      commits: [
        { sha: SHA, subject: "feat: linked (#12)", pr: 12 },
        { sha: "f".repeat(40), subject: "chore: plain", pr: null },
      ],
      more: 4,
    });
    await open(BINARY, load, () => bodyText().includes("chore: plain"));
    const linked = anchors().find((a) => a.textContent === "feat: linked (#12)");
    expect(linked?.getAttribute("href")).toBe("https://github.com/macintacos/caret/pull/12");
    expect(anchors().some((a) => a.textContent === "chore: plain")).toBe(false);
    const more = anchors().find((a) => a.textContent?.includes("4 more"));
    expect(more?.getAttribute("href")).toBe(
      `https://github.com/macintacos/caret/compare/${SHA}...trunk`,
    );
  });

  test("a failed load still shows the compare link, the command, and the guidance", async () => {
    await open(
      BUNDLE,
      () => Promise.reject(new Error("502")),
      () => bodyText().includes("Couldn't load"),
    );
    expect(
      anchors().some(
        (a) =>
          a.getAttribute("href") === "https://github.com/macintacos/caret/compare/v1.4.0...v1.5.0",
      ),
    ).toBe(true);
    const command = content()?.querySelector<HTMLInputElement>("[aria-label='Upgrade command']");
    expect(command?.value).toBe(RELEASE_COMMAND);
    expect(bodyText()).toContain("Then restart OpenCode.");
  });

  test("the dialog content holds focus on open", async () => {
    await open(
      BUNDLE,
      () => new Promise(() => {}),
      () => document.activeElement === content(),
    );
    expect(document.activeElement === content()).toBe(true);
  });
});
