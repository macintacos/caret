import "@ui/support/mount.ts";
import { afterEach, expect, test } from "bun:test";

import { flushSync, mount, unmount } from "svelte";

import type { DirListing } from "@core/lib/types";
import { until } from "@test/support/poll.ts";
import { type LogCapture, logCapture } from "@ui/support/helpers.ts";
import { render } from "@ui/support/mount.ts";
import FolderTree from "@/components/FolderTree.svelte";
import { createFolderMemory, type FolderMemory } from "$lib/folderTree.ts";

// The folder popover (EXC-918). What a mount can honestly answer here is the
// card's own framing: the header it puts around a reference, the request it
// makes for the first level, and the three states that are a line of text
// (loading, empty, error). The tree itself is @pierre/trees behind a shadow root
// and virtualizes against a layout happy-dom does not do, so expanding a level,
// opening a file row, and the dismissal gestures are e2e — see
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

/** Install a fetch double that 404s every `/dir` request. */
function serveNotFound(): LogCapture {
  return logCapture((url) =>
    Promise.resolve(new Response(null, { status: url.includes("/dir?") ? 404 : 204 })),
  );
}

/** Serve one `/dir` request per call, delegating to `answer(dirCalls)` for what
 * (or whether) to serve; every other URL answers 204. */
function servePerCall(
  answer: (dirCalls: number) => { entries: DirListing["entries"]; total: number } | "not-found",
): LogCapture & { dirCalls: () => number } {
  let dirCalls = 0;
  const cap = logCapture((url) => {
    if (!url.includes("/dir?")) return Promise.resolve(new Response(null, { status: 204 }));
    dirCalls += 1;
    const result = answer(dirCalls);
    if (result === "not-found") return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(
      new Response(JSON.stringify({ path: "src/lib", ...result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  return Object.assign(cap, { dirCalls: () => dirCalls });
}

function props(
  over: Partial<{
    path: string;
    reviewId: string;
    memory: FolderMemory;
    showShortcutHints: boolean;
  }> = {},
) {
  return {
    reviewId: over.reviewId ?? ID,
    path: over.path ?? "src/lib",
    anchor: { top: 100, bottom: 120, left: 40 },
    // A fresh instance per card unless a case deliberately shares one — which is
    // exactly how DiffPlanView uses it, and what keeps one case's card from
    // restoring into the next one's mount (EXC-1138).
    memory: over.memory ?? createFolderMemory(),
    // Never fires here: opening a file row is a click on a virtualized row behind
    // a shadow root, so it is e2e (test/e2e/folder-refs.e2e.ts).
    onOpenFile: () => {},
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

test("spins a decorative glyph beside the loading text", async () => {
  // The spinner is the motion that says the card is fetching. It is aria-hidden
  // because the "Loading…" beside it is already the accessible message — a
  // Spinner left at its default role="status" + aria-label="Loading" would put
  // the word into the accessibility tree twice on one line. data-slot is the
  // vendored tree's own assertion handle (doc/agents/shadcn-rules.md); the
  // reduced-motion clamp is a media query happy-dom cannot evaluate, so it is
  // verified in the browser rather than here.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  cap = logCapture(async (url) => {
    if (!url.includes("/dir?")) return new Response(null, { status: 204 });
    await gate;
    return new Response(JSON.stringify({ path: "src/lib", entries: [], total: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const { target } = render(FolderTree, props());
  await until(() => state(target) === "loading");

  const placeholder = target.querySelector('[data-folder-state="loading"]');
  expect(placeholder?.textContent).toContain("Loading");
  const spinner = placeholder?.querySelector('[data-slot="spinner"]');
  expect(spinner).toBeTruthy();
  expect(spinner?.getAttribute("aria-hidden")).toBe("true");

  release();
  await until(() => state(target) === "empty");
});

test("says so when the level cannot be read", async () => {
  // One 404 covers every refusal the route makes, so the card has one failure to
  // show rather than a taxonomy the reader cannot act on.
  cap = serveNotFound();
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

// Reopening a card the reader has already been in (EXC-1138). Which folders come
// back open and where the list sits are the tree's own state, behind the shadow
// root — those are e2e. What a mount answers here is the half that decides
// whether a restore happened at all: the request the card does NOT make.

/** Serve one two-entry level and count every `/dir` request. Mounted by hand
 * rather than through `render()` because the memory is filed at unmount, which
 * the shared harness performs in afterEach — after the assertions. */
function countingServe(): { dirCalls: () => number; cap: LogCapture } {
  let dirCalls = 0;
  const listing: DirListing = {
    path: "src/lib",
    entries: [
      { name: "deep", kind: "directory" },
      { name: "a.ts", kind: "file" },
    ],
    total: 2,
  };
  const capture = logCapture((url) => {
    if (!url.includes("/dir?")) return Promise.resolve(new Response(null, { status: 204 }));
    dirCalls += 1;
    return Promise.resolve(
      new Response(JSON.stringify(listing), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  return { dirCalls: () => dirCalls, cap: capture };
}

/** Mount a card into `memory`, wait for its level, then dismiss it — which is
 * what files the card. Mounted by hand rather than through `render()` because
 * the filing happens at unmount, which the shared harness performs in afterEach,
 * after the assertions. */
async function openThenDismiss(over: Parameters<typeof props>[0] = {}): Promise<void> {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(FolderTree, { target, props: props(over) });
  await until(() => target.querySelector(".ft-tree") !== null);
  unmount(instance);
  flushSync();
  target.remove();
}

/** Serve one two-entry level, open a card into a fresh memory, and dismiss it —
 * the common opening for the reopen-restore tests below. */
async function primeMemory(): Promise<{
  serve: ReturnType<typeof countingServe>;
  memory: FolderMemory;
}> {
  const serve = countingServe();
  cap = serve.cap;
  const memory = createFolderMemory();
  await openThenDismiss({ memory });
  return { serve, memory };
}

test("reopening a folder reference asks the daemon for nothing", async () => {
  // The whole point of caching the served levels: a restored card is
  // constructed from them in one frame rather than refetching the root and
  // reassembling itself as each level settles.
  const { serve, memory } = await primeMemory();
  expect(serve.dirCalls()).toBe(1);

  const { target } = render(FolderTree, props({ memory }));
  await until(() => target.querySelector(".ft-tree") !== null);
  expect(serve.dirCalls()).toBe(1);
});

test("a second folder reference in the same review is fetched on its own", async () => {
  const { serve, memory } = await primeMemory();

  const { target } = render(FolderTree, props({ memory, path: "src/other" }));
  await until(() => target.querySelector(".ft-tree") !== null);
  expect(serve.dirCalls()).toBe(2);
});

test("never restores one review's card over another's", async () => {
  // The instance is replaced on a review switch, so this can only happen through
  // a mis-wired swap — which the review half of the key is there to survive.
  const { serve, memory } = await primeMemory();

  const { target } = render(FolderTree, props({ memory, reviewId: "r2" }));
  await until(() => target.querySelector(".ft-tree") !== null);
  expect(serve.dirCalls()).toBe(2);
});

test("a review switch leaves the incoming card nothing to restore", async () => {
  // DiffPlanView discards the whole instance rather than emptying one in place,
  // because the outgoing card files ITS memory on the way out — after the switch
  // has already run. That write lands in the instance nobody holds any more.
  const { serve } = await primeMemory();

  const { target } = render(FolderTree, props({ memory: createFolderMemory() }));
  await until(() => target.querySelector(".ft-tree") !== null);
  expect(serve.dirCalls()).toBe(2);
});

test("a restored card asks again for a level the daemon refused", async () => {
  // The other half of leaving `failed` out of the snapshot. A refusal is
  // terminal for a card and reopening is its documented retry — but the tree is
  // restored with that directory already EXPANDED, and the library's
  // `subscribe` deliberately swallows its initial snapshot, so nothing walks the
  // rows unless the card does it itself. Without that walk the folder comes back
  // open, empty, and permanently unasked-for.
  const serve = countingServe();
  cap = serve.cap;
  const memory = createFolderMemory();
  memory.write(ID, "src/lib", {
    rootPath: "src/lib",
    elided: 0,
    // The root arrived; `deep`'s level never did, so it is absent from `loaded`
    // exactly as `fail()` leaves it.
    levels: { paths: ["deep/", "a.ts"], loaded: [""], skipped: [], elided: [] },
    expanded: ["deep/"],
    topPath: undefined,
  });

  const { target } = render(FolderTree, props({ memory }));
  await until(() => target.querySelector(".ft-tree") !== null);
  // Not the root — that came from memory. This is `deep`, re-asked for.
  await until(() => serve.dirCalls() === 1);
  expect(serve.dirCalls()).toBe(1);
});

// Refreshing a cached tree (EXC-1139). The cache above has no invalidation, so
// the card needs a way to re-read a working copy an agent is still editing.
// What a mount answers here is the control's own framing and the requests it
// makes; that the expansion and the scroll survive the repaint is the real
// tree's business, and lives in test/e2e/folder-refs.e2e.ts.

/** Serve one level, count every `/dir` request, and hold every request AFTER
 * the first until `open()` — which is the card's own first level served and a
 * refresh left in flight. */
function gatedServe(): { dirCalls: () => number; open: () => void; cap: LogCapture } {
  let dirCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const listing: DirListing = {
    path: "src/lib",
    entries: [{ name: "a.ts", kind: "file" }],
    total: 1,
  };
  const capture = logCapture(async (url) => {
    if (!url.includes("/dir?")) return new Response(null, { status: 204 });
    dirCalls += 1;
    if (dirCalls > 1) await gate;
    return new Response(JSON.stringify(listing), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { dirCalls: () => dirCalls, open: release, cap: capture };
}

const refreshControl = (el: HTMLElement) => el.querySelector<HTMLButtonElement>(".ft-refresh");
/** What the header's live region currently says; `""` when it has nothing to
 * report, since the region itself is always mounted. */
const stale = (el: HTMLElement) => el.querySelector(".ft-stale")?.textContent;

/** Serve a gated level and wait for the refresh control to appear — the common
 * opening of the tests that drive it. */
async function openWithRefresh(): Promise<{
  target: HTMLElement;
  serve: ReturnType<typeof gatedServe>;
}> {
  const serve = gatedServe();
  cap = serve.cap;
  const { target } = render(FolderTree, props());
  await until(() => refreshControl(target) !== null);
  return { target, serve };
}

test("offers a named control for re-reading the folder", async () => {
  // A real button rather than a click handler on a glyph: the reader who opened
  // this card from the keyboard has to be able to reach it from there too.
  cap = serveListing({ path: "src/lib", entries: [{ name: "a.ts", kind: "file" }], total: 1 });
  const { target } = render(FolderTree, props());
  await until(() => refreshControl(target) !== null);
  const control = refreshControl(target);
  expect(control?.tagName).toBe("BUTTON");
  expect(control?.getAttribute("aria-label")).toBe("Re-read this folder");
});

test("offers nothing to refresh on a card that has no tree", async () => {
  // The reference effect owns the first fetch, and a card that never got a level
  // has no cached tree to re-read — reopening it is its retry.
  cap = serveNotFound();
  const { target } = render(FolderTree, props());
  await until(() => state(target) === "error");
  expect(refreshControl(target)).toBeNull();
});

test("re-reads the level the card is showing", async () => {
  const { target, serve } = await openWithRefresh();
  expect(serve.dirCalls()).toBe(1);

  refreshControl(target)?.click();
  expect(await until(() => serve.dirCalls() === 2)).toBe(true);
  serve.open();
});

test("does not stack a second round of requests on the first", async () => {
  const { target, serve } = await openWithRefresh();

  refreshControl(target)?.click();
  expect(await until(() => refreshControl(target)?.getAttribute("aria-disabled") === "true")).toBe(
    true,
  );
  refreshControl(target)?.click();
  expect(serve.dirCalls()).toBe(2);

  serve.open();
  expect(await until(() => refreshControl(target)?.getAttribute("aria-disabled") === "false")).toBe(
    true,
  );
});

/** Serve `answer`, mount, and click refresh once — waiting for the header to
 * report the failed refresh. The live region is mounted from the start with
 * empty text — see the markup's own note — so what this proves is what it
 * says, not whether it is there. */
async function refreshExpectingStale(
  answer: (dirCalls: number) => { entries: DirListing["entries"]; total: number } | "not-found",
): Promise<HTMLElement> {
  cap = servePerCall(answer);
  const { target } = render(FolderTree, props());
  await until(() => refreshControl(target) !== null);
  refreshControl(target)?.click();
  expect(await until(() => stale(target) === "couldn't refresh")).toBe(true);
  return target;
}

test("keeps the tree it has when a refresh cannot be read", async () => {
  // Emptying the card would cost the reader everything they had open in exchange
  // for a request that failed — so the stale tree stands.
  const target = await refreshExpectingStale((n) =>
    n > 1 ? "not-found" : { entries: [{ name: "a.ts", kind: "file" }], total: 1 },
  );
  expect(target.querySelector(".ft-tree")).not.toBeNull();
});

test("stops saying a refresh failed once one succeeds", async () => {
  const target = await refreshExpectingStale((n) =>
    n === 2 ? "not-found" : { entries: [{ name: "a.ts", kind: "file" }], total: 1 },
  );
  refreshControl(target)?.click();
  expect(await until(() => stale(target) === "")).toBe(true);
});

test("files the tree it re-read, not the one it replaced", async () => {
  // The whole reason `Levels.reset` mutates rather than rebinding: the tree
  // effect captured that instance when it mounted, so a refresh that swapped the
  // variable would leave the teardown filing the card as it was BEFORE the
  // refresh — and reopening would restore a tree the reader had already replaced.
  cap = servePerCall((n) =>
    // The refreshed level reports an elision the first one did not, which is the
    // card's own signal that the refresh LANDED — `n` only says the request went
    // out, and unmounting on that files the card mid-flight.
    n === 1
      ? { entries: [{ name: "before.ts", kind: "file" }], total: 1 }
      : { entries: [{ name: "after.ts", kind: "file" }], total: 5 },
  );
  const memory = createFolderMemory();
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(FolderTree, { target, props: props({ memory }) });
  await until(() => target.querySelector(".ft-refresh") !== null);

  target.querySelector<HTMLButtonElement>(".ft-refresh")?.click();
  expect(await until(() => target.querySelector(".ft-elided") !== null)).toBe(true);
  unmount(instance);
  flushSync();
  target.remove();

  expect(memory.read(ID, "src/lib")?.levels.paths).toEqual(["after.ts"]);
});

test("says an emptied folder is empty without taking the control away", async () => {
  // A refresh that finds the folder gone empty must not paint a blank card — and
  // must not remove the one affordance that could bring it back.
  cap = servePerCall((n) => {
    const entries: DirListing["entries"] = n === 1 ? [{ name: "a.ts", kind: "file" }] : [];
    return { entries, total: entries.length };
  });
  const { target } = render(FolderTree, props());
  await until(() => refreshControl(target) !== null);

  refreshControl(target)?.click();
  expect(await until(() => state(target) === "empty")).toBe(true);
  expect(target.textContent).toContain("This folder is empty.");
  expect(refreshControl(target)).not.toBeNull();
});
