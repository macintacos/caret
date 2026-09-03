import "@ui/test-setup.ts";
import { expect, test } from "bun:test";

import { root, row as rowOf } from "$lib/diffview/dom-fixture.ts";
import { syncInlineImages } from "$lib/diffview/inlineImages.ts";
import type { ImageSpan, ImageSpanMap } from "$lib/diffview/links.ts";

// syncInlineImages adds the one element in the plan view that is content rather
// than decoration. SourceView drives it from a MutationObserver watching
// childList over the whole subtree, so a pass that re-created a settled row's
// element would loop that observer forever — which is why idempotency is pinned
// here rather than assumed. Real layout (the row track growing around the image,
// the gutter number growing with it) has no answer under happy-dom and is pinned
// by images.e2e.ts instead.

const row = (line: number, text: string): HTMLElement => rowOf(line, [text]);

function map(entries: [number, ImageSpan[]][]): ImageSpanMap {
  return new Map(entries);
}

function span(url: string, alt = "a chart"): ImageSpan {
  return { url, alt };
}

function images(host: HTMLElement): HTMLImageElement[] {
  return [...host.querySelectorAll("img[data-md-image]")] as HTMLImageElement[];
}

test("an image span becomes an img on its row", () => {
  const host = root(row(1, "![a chart](https://cdn.test/c.png)"));
  syncInlineImages(host, map([[1, [span("https://cdn.test/c.png")]]]));
  const [img] = images(host);
  expect(img?.getAttribute("src")).toBe("https://cdn.test/c.png");
  expect(img?.getAttribute("alt")).toBe("a chart");
  expect(img?.parentElement?.getAttribute("data-line")).toBe("1");
});

test("the img is appended last, after the row's text tokens", () => {
  // Every other pass over a row (splitRow, tagRow, tagTokenAt) locates a token by
  // walking direct children and accumulating text length. An img contributes no
  // characters, and sitting past the last one keeps it out of every such walk.
  const host = root(row(1, "![a chart](https://cdn.test/c.png)"));
  syncInlineImages(host, map([[1, [span("https://cdn.test/c.png")]]]));
  const children = [...(host.querySelector("[data-line]")?.children ?? [])];
  expect(children.at(-1)?.tagName).toBe("IMG");
  expect(children.at(0)?.tagName).toBe("SPAN");
});

test("the img sends no referrer and defers its fetch", () => {
  // The one outbound network element on this surface, so it takes the same stance
  // openLinkInNewTab takes for the other one.
  const host = root(row(1, "x"));
  syncInlineImages(host, map([[1, [span("https://cdn.test/c.png")]]]));
  expect(images(host)[0]?.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(images(host)[0]?.getAttribute("loading")).toBe("lazy");
});

test("a second pass over a settled row mutates nothing", () => {
  const host = root(row(1, "x"));
  const spans = map([[1, [span("https://cdn.test/c.png")]]]);
  syncInlineImages(host, spans);
  const first = images(host)[0];
  syncInlineImages(host, spans);
  expect(images(host)).toHaveLength(1);
  expect(images(host)[0]).toBe(first as HTMLImageElement);
});

test("a changed url replaces the element", () => {
  const host = root(row(1, "x"));
  syncInlineImages(host, map([[1, [span("https://cdn.test/old.png")]]]));
  syncInlineImages(host, map([[1, [span("https://cdn.test/new.png")]]]));
  expect(images(host).map((i) => i.getAttribute("src"))).toEqual(["https://cdn.test/new.png"]);
});

test("a changed alt replaces the element too", () => {
  // The accessible name is half of what the span carries, so the settle check
  // reads both. Comparing only the src would leave the old name in place on a
  // plan edit that reworded an alt without moving its asset.
  const host = root(row(1, "x"));
  syncInlineImages(host, map([[1, [span("https://cdn.test/c.png", "old name")]]]));
  syncInlineImages(host, map([[1, [span("https://cdn.test/c.png", "new name")]]]));
  expect(images(host).map((i) => i.getAttribute("alt"))).toEqual(["new name"]);
});

test("an emptied map clears a row's images", () => {
  const host = root(row(1, "x"));
  syncInlineImages(host, map([[1, [span("https://cdn.test/c.png")]]]));
  syncInlineImages(host, map([]));
  expect(images(host)).toHaveLength(0);
});

test("two images on a line render in source order", () => {
  const host = root(row(1, "x"));
  syncInlineImages(
    host,
    map([[1, [span("https://cdn.test/a.png", "a"), span("https://cdn.test/b.png", "b")]]]),
  );
  expect(images(host).map((i) => i.getAttribute("alt"))).toEqual(["a", "b"]);
});

test("a failed load hides the element rather than removing it", () => {
  // Removing it would make the next observer pass re-create it, and remembering
  // the failure would need module state. Hidden keeps the pass idempotent and
  // leaves the row reading as the chip and the literal markdown — the ladder's
  // second rung — with no broken-image chrome.
  const host = root(row(1, "x"));
  const spans = map([[1, [span("https://cdn.test/gone.png")]]]);
  syncInlineImages(host, spans);
  images(host)[0]?.dispatchEvent(new Event("error"));
  expect(images(host)[0]?.hidden).toBe(true);
  syncInlineImages(host, spans);
  expect(images(host)).toHaveLength(1);
  expect(images(host)[0]?.hidden).toBe(true);
});

test("a line with no rendered row is skipped", () => {
  const host = root(row(1, "x"));
  syncInlineImages(host, map([[9, [span("https://cdn.test/c.png")]]]));
  expect(images(host)).toHaveLength(0);
});
