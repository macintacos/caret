import "../../test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";
import {
  DIFF_LINE_NUMBERS_KEY,
  DIFF_OVERFLOW_KEY,
  readDisableLineNumbers,
  readOverflow,
  writeDisableLineNumbers,
  writeOverflow,
} from "./diffReaderPref.ts";

afterEach(() => localStorage.clear());

describe("readOverflow", () => {
  test("returns the stored value when valid", () => {
    localStorage.setItem(DIFF_OVERFLOW_KEY, "wrap");
    expect(readOverflow()).toBe("wrap");
  });

  test("defaults to scroll when nothing is stored", () => {
    expect(readOverflow()).toBe("scroll");
  });

  test("defaults to scroll on an unrecognized stored value", () => {
    localStorage.setItem(DIFF_OVERFLOW_KEY, "clip");
    expect(readOverflow()).toBe("scroll");
  });

  test("fails safe to scroll when localStorage throws", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(readOverflow()).toBe("scroll");
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });
});

describe("writeOverflow", () => {
  test("persists a valid value", () => {
    writeOverflow("wrap");
    expect(localStorage.getItem(DIFF_OVERFLOW_KEY)).toBe("wrap");
    expect(readOverflow()).toBe("wrap");
  });

  test("swallows a localStorage write failure", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(() => writeOverflow("wrap")).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });
});

describe("readDisableLineNumbers", () => {
  test("returns true when the gutter is stored hidden", () => {
    localStorage.setItem(DIFF_LINE_NUMBERS_KEY, "1");
    expect(readDisableLineNumbers()).toBe(true);
  });

  test("returns false when the gutter is stored shown", () => {
    localStorage.setItem(DIFF_LINE_NUMBERS_KEY, "0");
    expect(readDisableLineNumbers()).toBe(false);
  });

  test("defaults to false (numbers shown) when nothing is stored", () => {
    expect(readDisableLineNumbers()).toBe(false);
  });

  test("defaults to false on an unrecognized stored value", () => {
    localStorage.setItem(DIFF_LINE_NUMBERS_KEY, "yes");
    expect(readDisableLineNumbers()).toBe(false);
  });

  test("fails safe to false when localStorage throws", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(readDisableLineNumbers()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });
});

describe("writeDisableLineNumbers", () => {
  test("persists hidden as 1 and shown as 0", () => {
    writeDisableLineNumbers(true);
    expect(localStorage.getItem(DIFF_LINE_NUMBERS_KEY)).toBe("1");
    expect(readDisableLineNumbers()).toBe(true);

    writeDisableLineNumbers(false);
    expect(localStorage.getItem(DIFF_LINE_NUMBERS_KEY)).toBe("0");
    expect(readDisableLineNumbers()).toBe(false);
  });

  test("swallows a localStorage write failure", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(() => writeDisableLineNumbers(true)).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });
});
