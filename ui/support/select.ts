// Drives a mounted vendored Select (SettingSelect) under happy-dom. Three facts keep a
// suite built on it from being silently inert:
//
//   * The content PORTALS to document.body on a deferred tick, so every open is polled
//     with `flushUntil` and queried off `document.body`, not the mount target.
//   * The trigger toggles on `pointerdown` — `SelectTriggerState.onclick` only calls
//     `focus()` — so `.click()` neither opens nor closes it.
//   * An open panel left behind at unmount keeps its effects alive into the next test
//     (bits-ui's portal presence waits for an `animationend` happy-dom never fires), so
//     each test closes what it opened.
import { expect } from "bun:test";

import { flushUntil } from "@ui/support/mount.ts";

export const selectTrigger = () =>
  document.body.querySelector<HTMLElement>("[data-slot='select-trigger']");
export const selectContent = () =>
  document.body.querySelector<HTMLElement>("[data-slot='select-content']");

export function pointer(el: Element | null, type: string): void {
  el?.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" }),
  );
}

/** Open the panel and wait for the portalled content to land. */
export async function openSelect(flush: () => void): Promise<void> {
  pointer(selectTrigger(), "pointerdown");
  await flushUntil(flush, () => selectContent() !== null);
  expect(selectContent() !== null).toBe(true);
}

/** Close the panel; asserted, since `flushUntil` exhausts its budget without throwing. */
export async function closeSelect(flush: () => void): Promise<void> {
  pointer(selectTrigger(), "pointerdown");
  await flushUntil(flush, () => selectContent() === null);
  expect(selectContent() === null).toBe(true);
}
