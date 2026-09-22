import "@ui/support/mount.ts";

import { describe, expect, test } from "bun:test";

import { Separator } from "$lib/components/ui/separator/index.js";

import { flushUntil, render } from "@ui/support/mount.ts";

const root = (target: HTMLElement) => target.querySelector("[data-slot='separator']");

describe("Separator", () => {
  test("is hidden from assistive tech by default", async () => {
    const { target, flush } = render(Separator, {});
    await flushUntil(flush, () => root(target) !== null);
    expect(root(target)?.getAttribute("role")).toBe("none");
    expect(root(target)?.getAttribute("aria-hidden")).toBe("true");
  });

  test("announces as a separator when not decorative", async () => {
    const { target, flush } = render(Separator, { decorative: false });
    await flushUntil(flush, () => root(target) !== null);
    expect(root(target)?.getAttribute("role")).toBe("separator");
  });
});
