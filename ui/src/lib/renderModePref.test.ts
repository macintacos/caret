import "../../test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { RENDER_MODE_KEY, readRenderMode, writeRenderMode } from "./renderModePref.ts";

afterEach(() => localStorage.clear());

describe("readRenderMode", () => {
  test("returns the stored value when valid", () => {
    localStorage.setItem(RENDER_MODE_KEY, "source");
    expect(readRenderMode()).toBe("source");
  });

  test("defaults to rendered when nothing is stored", () => {
    expect(readRenderMode()).toBe("rendered");
  });

  test("defaults to rendered on an unrecognized stored value", () => {
    localStorage.setItem(RENDER_MODE_KEY, "sideways");
    expect(readRenderMode()).toBe("rendered");
  });

  test("fails safe to rendered when localStorage throws", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(readRenderMode()).toBe("rendered");
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });
});

describe("writeRenderMode", () => {
  test("round-trips both values", () => {
    writeRenderMode("source");
    expect(readRenderMode()).toBe("source");
    writeRenderMode("rendered");
    expect(readRenderMode()).toBe("rendered");
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
      expect(() => writeRenderMode("source")).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });
});
