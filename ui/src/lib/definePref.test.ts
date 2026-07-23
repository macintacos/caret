import "../../test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { defineFlagPref, definePref, knownPrefKeys, registerPrefKey } from "$lib/definePref.ts";

afterEach(() => localStorage.clear());

describe("registerPrefKey / knownPrefKeys", () => {
  test("a registered key appears in knownPrefKeys()", () => {
    registerPrefKey("test.register.plain");
    expect(knownPrefKeys()).toContain("test.register.plain");
  });

  test("registering the same key twice does not duplicate it", () => {
    registerPrefKey("test.register.dupe");
    registerPrefKey("test.register.dupe");
    const count = knownPrefKeys().filter((k) => k === "test.register.dupe").length;
    expect(count).toBe(1);
  });
});

describe("definePref (enum)", () => {
  const KEY = "test.definePref.enum";
  const pref = definePref<"a" | "b">(KEY, ["a", "b"], "a");

  test("registers its key", () => {
    expect(knownPrefKeys()).toContain(KEY);
  });

  test("surfaces the key as KEY", () => {
    expect(pref.KEY).toBe(KEY);
  });

  test("reads a stored valid value", () => {
    localStorage.setItem(KEY, "b");
    expect(pref.read()).toBe("b");
  });

  test("defaults to the fallback when nothing is stored", () => {
    expect(pref.read()).toBe("a");
  });

  test("defaults to the fallback on an unrecognized stored value", () => {
    localStorage.setItem(KEY, "z");
    expect(pref.read()).toBe("a");
  });

  test("write persists a valid value", () => {
    pref.write("b");
    expect(localStorage.getItem(KEY)).toBe("b");
    expect(pref.read()).toBe("b");
  });

  test("read fails safe to the fallback when localStorage throws", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(pref.read()).toBe("a");
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
    }
  });

  test("write swallows a localStorage failure", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(() => pref.write("b")).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
    }
  });
});

describe("defineFlagPref (boolean flag)", () => {
  const KEY = "test.defineFlagPref.flag";
  const pref = defineFlagPref(KEY);

  test("registers its key", () => {
    expect(knownPrefKeys()).toContain(KEY);
  });

  test("surfaces the key as KEY", () => {
    expect(pref.KEY).toBe(KEY);
  });

  test("reads false when nothing is stored", () => {
    expect(pref.read()).toBe(false);
  });

  test("reads true when the stored value is '1'", () => {
    localStorage.setItem(KEY, "1");
    expect(pref.read()).toBe(true);
  });

  test("write(true) persists '1'", () => {
    pref.write(true);
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(pref.read()).toBe(true);
  });

  test("write(false) removes the key", () => {
    localStorage.setItem(KEY, "1");
    pref.write(false);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(pref.read()).toBe(false);
  });

  test("defaults onError to false (fails safe to unset)", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(pref.read()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
    }
  });

  test("honors onError: true (fails safe to set — e.g. the drag hint's don't-nag)", () => {
    const failSafeSet = defineFlagPref("test.defineFlagPref.onErrorTrue", { onError: true });
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(failSafeSet.read()).toBe(true);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
    }
  });

  test("write swallows a localStorage failure", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(() => pref.write(true)).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
    }
  });
});
