import "@ui/test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { knownPrefKeys } from "$lib/definePref.ts";
import {
  readToastedUpdate,
  seededUpdatesCheck,
  seedUpdatesCheck,
  UPDATE_TOASTED_KEY,
  writeToastedUpdate,
} from "$lib/updatesPref.ts";

// EXC-1207. What this browser knows about updates before the next fetch: which update
// signature it has already toasted (persisted), and the daemon-owned `updates.check`
// App seeds from GET /api/update's `checkEnabled` so the registry field's synchronous
// read() can answer.

afterEach(() => {
  localStorage.clear();
  seedUpdatesCheck(true);
});

describe("the toasted-update marker", () => {
  test("round-trips a signature", () => {
    writeToastedUpdate("release:1.5.0");
    expect(readToastedUpdate()).toBe("release:1.5.0");
  });

  test("reads null with nothing stored", () => {
    expect(readToastedUpdate()).toBeNull();
  });

  test("a later signature replaces the earlier one", () => {
    writeToastedUpdate("release:1.5.0");
    writeToastedUpdate("release:1.6.0");
    expect(readToastedUpdate()).toBe("release:1.6.0");
  });

  test("joins the --fresh reset set", () => {
    expect(knownPrefKeys()).toContain(UPDATE_TOASTED_KEY);
  });

  test("never throws when storage itself does", () => {
    // Private mode, disabled storage, quota. A marker that cannot persist must degrade
    // to re-toasting once, never to a thrown load.
    const storage = globalThis.localStorage;
    const poisoned = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    Object.defineProperty(globalThis, "localStorage", { value: poisoned, configurable: true });
    try {
      expect(readToastedUpdate()).toBeNull();
      expect(() => writeToastedUpdate("release:1.5.0")).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    }
  });
});

describe("the seeded updates.check holder", () => {
  test("defaults on, so a load that never seeds behaves as the daemon's own default does", () => {
    expect(seededUpdatesCheck()).toBe(true);
  });

  test("reads back what App seeded from the daemon", () => {
    seedUpdatesCheck(false);
    expect(seededUpdatesCheck()).toBe(false);
    seedUpdatesCheck(true);
    expect(seededUpdatesCheck()).toBe(true);
  });

  test("holds no localStorage key of its own — the daemon owns the value", () => {
    seedUpdatesCheck(false);
    expect(localStorage.length).toBe(0);
  });
});
