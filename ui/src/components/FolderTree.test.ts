import "@ui/test-mount.ts";
import { afterEach, expect, test } from "bun:test";

import type { DirListing } from "@core/lib/types";
import { until } from "@test/support/poll.ts";
import { type LogCapture, logCapture } from "@ui/test-helpers.ts";
import { render } from "@ui/test-mount.ts";
import FolderTree from "@/components/FolderTree.svelte";

// The folder popover (EXC-918). What a mount can honestly answer here is the
// card's own framing: the header it puts around a reference, the request it
// makes for the first level, and the three states that are a line of text
// (loading, empty, error). The tree itself is @pierre/trees behind a shadow root
// and virtualizes against a layout happy-dom does not do, so expanding a level,
// files being inert, and the dismissal gestures are e2e — see
// test/e2e/folder-refs.e2e.ts and doc/agents/browser-testing.md.

const ID = "r1";

/** Install a fetch double answering the dir endpoint with `listing`. */
function serveListing(listing: DirListing): LogCapture {
  return logCapture((url) => {
    if (url.includes("/dir?")) {
      return Promise.resolve(
        new Response(JSON.stringify(listing), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  });
}

function props(over: Partial<{ path: string; showShortcutHints: boolean }> = {}) {
  return {
    reviewId: ID,
    path: over.path ?? "src/lib",
    anchor: { top: 100, bottom: 120, left: 40 },
    ...(over.showShortcutHints === undefined ? {} : { showShortcutHints: over.showShortcutHints }),
  };
}

let cap: LogCapture | undefined;
afterEach(() => {
  cap?.restore();
  cap = undefined;
});

const state = (el: HTMLElement) =>
  el.querySelector("[data-folder-state]")?.getAttribute("data-folder-state");

test("names the referenced directory in the header", async () => {
  cap = serveListing({ path: "src/lib", entries: [{ name: "a.ts", kind: "file" }], total: 1 });
  const { target } = render(FolderTree, props());
  await until(() => target.querySelector(".ft-path")?.textContent === "src/lib");
  expect(target.querySelector(".ft-badge")?.textContent).toBe("Folder");
});

test("asks the daemon for the reference's own level, anchored on it", async () => {
  let seen = "";
  cap = logCapture((url) => {
    if (url.includes("/dir?")) {
      seen = url;
      return Promise.resolve(
        new Response(JSON.stringify({ path: "src/lib", entries: [], total: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  const { target } = render(FolderTree, props());
  await until(() => seen !== "");
  const parsed = new URL(seen, "http://localhost");
  expect(parsed.pathname).toBe(`/api/reviews/${ID}/dir`);
  expect(parsed.searchParams.get("root")).toBe("src/lib");
  // Empty `path` is the anchor itself — the card opens on the reference's own
  // immediate children, in one round trip.
  expect(parsed.searchParams.get("path")).toBe("");
  expect(state(target)).toBe("empty");
});

test("says an empty directory is empty rather than showing a blank card", async () => {
  cap = serveListing({ path: "src/lib", entries: [], total: 0 });
  const { target } = render(FolderTree, props());
  await until(() => state(target) === "empty");
  expect(target.textContent).toContain("This folder is empty.");
});

test("says so when the level cannot be read", async () => {
  // One 404 covers every refusal the route makes, so the card has one failure to
  // show rather than a taxonomy the reader cannot act on.
  cap = logCapture((url) =>
    Promise.resolve(new Response(null, { status: url.includes("/dir?") ? 404 : 204 })),
  );
  const { target } = render(FolderTree, props());
  await until(() => state(target) === "error");
  expect(target.textContent).toContain("Couldn't read this folder.");
});

test("reports how many rows the daemon's cap elided", async () => {
  // `total` counts the level before the cap, and the route has no page-past, so
  // this is a statement about what is unreachable — not an affordance.
  cap = serveListing({ path: "src/lib", entries: [{ name: "a.ts", kind: "file" }], total: 12 });
  const { target } = render(FolderTree, props());
  await until(() => target.querySelector(".ft-elided") !== null);
  expect(target.querySelector(".ft-elided")?.textContent).toBe("11 more not shown");
});

test("says nothing about elision when the whole level came back", async () => {
  cap = serveListing({ path: "src/lib", entries: [{ name: "a.ts", kind: "file" }], total: 1 });
  const { target } = render(FolderTree, props());
  await until(() => target.querySelector(".ft-tree") !== null);
  expect(target.querySelector(".ft-elided")).toBeNull();
});

test("omits the esc hint when shortcut hints are off", async () => {
  // The hint follows the same Settings toggle as the rest of them; Escape still
  // closes the card, which is DiffPlanView's handler and covered by e2e.
  cap = serveListing({ path: "src/lib", entries: [], total: 0 });
  const { target } = render(FolderTree, props({ showShortcutHints: false }));
  await until(() => state(target) === "empty");
  expect(target.querySelector(".ft-hint")).toBeNull();
});
