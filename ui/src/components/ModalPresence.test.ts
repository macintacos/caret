import "@ui/support/mount.ts";

import { expect, test } from "bun:test";

import { render } from "@ui/support/mount.ts";
import ModalPresenceFixture from "@/components/ModalPresence-fixture.svelte";

const surface = (target: HTMLElement) => target.querySelector(".surface");
const click = (target: HTMLElement, cls: string) =>
  target.querySelector<HTMLButtonElement>(cls)?.click();

test("an open surface survives a change to an unrelated field of the host's record", () => {
  const { target, flush } = render(ModalPresenceFixture, {});
  flush();
  const before = surface(target);

  click(target, ".toggle-other");
  flush();

  expect(before !== null && surface(target) === before).toBe(true);
});

test("closing then reopening mounts a fresh surface", () => {
  const { target, flush } = render(ModalPresenceFixture, {});
  flush();
  const before = surface(target);

  click(target, ".toggle-settings");
  flush();
  click(target, ".toggle-settings");
  flush();

  const after = surface(target);
  expect(before !== null && after !== null && after !== before).toBe(true);
});
