import "@ui/support/setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { APPROVE_MODE_KEY, readApproveMode, writeApproveMode } from "$lib/approveModePref.ts";
import { knownPrefKeys } from "$lib/definePref.ts";

// EXC-1354. The remembered approve-variant id, per browser origin. The ids are opaque
// and arrive from the adapter over the wire, so this is a bespoke read/write plus
// registerPrefKey rather than definePref's fixed allow-list.

afterEach(() => localStorage.clear());

describe("the remembered approve mode", () => {
  test("round-trips an id", () => {
    writeApproveMode("acceptEdits");
    expect(readApproveMode()).toBe("acceptEdits");
  });

  test("reads null with nothing stored, so the caller picks its own default", () => {
    expect(readApproveMode()).toBeNull();
  });

  test("a later id replaces the earlier one", () => {
    writeApproveMode("acceptEdits");
    writeApproveMode("auto");
    expect(readApproveMode()).toBe("auto");
  });

  test("joins the --fresh reset set", () => {
    expect(knownPrefKeys()).toContain(APPROVE_MODE_KEY);
  });

  test("never throws when storage itself does", () => {
    // Private mode, disabled storage, quota. A forgotten default is the worst this may
    // cost — never a thrown load.
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
      expect(readApproveMode()).toBeNull();
      expect(() => writeApproveMode("auto")).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    }
  });
});
