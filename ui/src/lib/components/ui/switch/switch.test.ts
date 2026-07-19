import "../../../../../test-mount.ts";

import { describe, expect, test } from "bun:test";

import { Switch } from "$lib/components/ui/switch/index.js";

import { capture, flushUntil, render } from "../../../../../test-mount.ts";

// bits-ui Switch is a plain (non-portalled) button[role=switch]; it mounts into
// the render target and reflects reactive state synchronously after a flush — no
// document.body portal, unlike Dialog.
const root = (target: HTMLElement) => target.querySelector("[data-slot='switch']");

describe("Switch", () => {
  test("renders unchecked by default", async () => {
    const { target, flush } = render(Switch, {});
    await flushUntil(flush, () => root(target) !== null);
    expect(root(target)?.getAttribute("data-state")).toBe("unchecked");
    expect(root(target)?.getAttribute("aria-checked")).toBe("false");
  });

  test("reflects the checked prop", async () => {
    const { target, flush } = render(Switch, { checked: true });
    await flushUntil(flush, () => root(target) !== null);
    expect(root(target)?.getAttribute("data-state")).toBe("checked");
    expect(root(target)?.getAttribute("aria-checked")).toBe("true");
  });

  test("fires onCheckedChange with the toggled value on click", async () => {
    const changed = capture<boolean>();
    const { target, flush } = render(Switch, { checked: false, onCheckedChange: changed.cb });
    await flushUntil(flush, () => root(target) !== null);
    (root(target) as HTMLButtonElement).click();
    flush();
    expect(changed.last()).toBe(true);
  });
});
