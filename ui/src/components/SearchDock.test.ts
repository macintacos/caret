import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import { render } from "@ui/support/mount.ts";
import SearchDock from "@/components/SearchDock.svelte";

const base = {
  open: false,
  hints: true,
  query: "",
  matchCount: 0,
  currentIndex: -1,
  oncommit: () => {},
  onnext: () => {},
  onprev: () => {},
  onclose: () => {},
};

const has = (target: HTMLElement, selector: string) => target.querySelector(selector) != null;

describe("SearchDock", () => {
  test("closed with hints on, it shows the / to search tab", () => {
    const { target } = render(SearchDock, base);
    expect(target.querySelector(".search-hint")?.textContent).toContain("to search");
    expect(has(target, ".plan-search")).toBe(false);
  });

  test("closed with hints off, it shows nothing", () => {
    const { target } = render(SearchDock, { ...base, hints: false });
    expect(has(target, ".search-dock")).toBe(true);
    expect(has(target, ".search-hint")).toBe(false);
  });

  test("open, the sheet takes the tab's place and shows the lip's keys", () => {
    const { target } = render(SearchDock, { ...base, open: true });
    expect(has(target, ".plan-search")).toBe(true);
    expect(has(target, ".search-hint")).toBe(false);
    expect(has(target, ".search-lip .search-key")).toBe(true);
  });

  // The touch rule in atoms.css drops an aria-hidden element whose child is a keycap,
  // caption and all: a key hint means nothing without keys.
  test("the tab is an aria-hidden key hint, so touch devices drop it", () => {
    const { target } = render(SearchDock, base);
    const tab = target.querySelector(".search-hint");
    expect(tab?.getAttribute("aria-hidden")).toBe("true");
    expect(tab?.querySelector(":scope > [data-slot='kbd']") != null).toBe(true);
  });
});
