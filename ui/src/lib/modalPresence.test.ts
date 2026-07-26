import { describe, expect, test } from "bun:test";

import { createModalPresence, type PresenceStore } from "$lib/modalPresence.ts";

// The factory is driven against a plain object, exactly as App's state modules are
// (svelte-rules.md "state modules are plain factories over an injected store") — so
// the re-open-mid-exit rule is assertable without mounting. It has to be: happy-dom
// has no getAnimations, so the exit window the rule guards cannot exist in a unit.
function store(): PresenceStore {
  return { present: false, generation: 0 };
}

describe("createModalPresence", () => {
  test("opening mounts the surface and bumps the generation", () => {
    const s = store();
    createModalPresence(s).sync(true);
    expect(s.present).toBe(true);
    expect(s.generation).toBe(1);
  });

  test("closing leaves the surface present so its exit can play", () => {
    const s = store();
    const presence = createModalPresence(s);
    presence.sync(true);
    presence.sync(false);
    expect(s.present).toBe(true);
  });

  test("a completed close unmounts the surface", () => {
    const s = store();
    const presence = createModalPresence(s);
    presence.sync(true);
    presence.sync(false);
    presence.settle(false);
    expect(s.present).toBe(false);
  });

  test("re-opening mid-exit remounts without ever dropping the surface", () => {
    const s = store();
    const presence = createModalPresence(s);
    presence.sync(true);
    presence.sync(false);
    presence.sync(true);
    expect(s.present).toBe(true);
    expect(s.generation).toBe(2);
  });

  test("a completion reported while open does not unmount", () => {
    const s = store();
    const presence = createModalPresence(s);
    presence.sync(true);
    presence.settle(true);
    expect(s.present).toBe(true);
  });
});
