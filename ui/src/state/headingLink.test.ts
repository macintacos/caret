import "../../test-setup.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { headingLine, setHeadingLine, takeHeadingLine } from "./headingLink.ts";

// Set the URL's query params directly. happy-dom's base is about:blank and
// rejects a bare relative path, so build the href off the current location
// (the same shape setHeadingLine writes).
function setParams(params: Record<string, string | null>) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value == null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  history.replaceState(null, "", url.href);
}

function clearUrl() {
  setParams({ review: null, line: null });
}

beforeEach(clearUrl);
afterEach(clearUrl);

describe("headingLine", () => {
  test("returns the 1-based line from the `line` param", () => {
    setParams({ line: "42" });
    expect(headingLine()).toBe(42);
  });

  test("returns null when no `line` param is set", () => {
    expect(headingLine()).toBe(null);
  });

  test("rejects non-finite, zero, and negative values", () => {
    for (const bad of ["0", "-3", "abc", "1.5e", ""]) {
      setParams({ line: bad });
      expect(headingLine()).toBe(null);
    }
  });

  test("floors a fractional value to a whole source line", () => {
    setParams({ line: "12.9" });
    expect(headingLine()).toBe(12);
  });
});

describe("setHeadingLine", () => {
  test("writes the line param", () => {
    setHeadingLine(7);
    expect(new URLSearchParams(location.search).get("line")).toBe("7");
  });

  test("deletes the line param on null", () => {
    setParams({ line: "7" });
    setHeadingLine(null);
    expect(new URLSearchParams(location.search).get("line")).toBe(null);
  });

  test("preserves the review param alongside line", () => {
    setParams({ review: "abc" });
    setHeadingLine(9);
    const search = new URLSearchParams(location.search);
    expect(search.get("review")).toBe("abc");
    expect(search.get("line")).toBe("9");
  });

  test("does not write a line for a non-positive value (treated as cleared)", () => {
    setParams({ line: "5" });
    setHeadingLine(0);
    expect(new URLSearchParams(location.search).get("line")).toBe(null);
  });
});

describe("takeHeadingLine", () => {
  test("reads the line once and clears the param", () => {
    setParams({ line: "15" });
    expect(takeHeadingLine()).toBe(15);
    expect(new URLSearchParams(location.search).get("line")).toBe(null);
    // A second take after consumption yields null.
    expect(takeHeadingLine()).toBe(null);
  });

  test("clearing the line preserves the review param", () => {
    setParams({ review: "abc", line: "15" });
    expect(takeHeadingLine()).toBe(15);
    expect(new URLSearchParams(location.search).get("review")).toBe("abc");
    expect(new URLSearchParams(location.search).get("line")).toBe(null);
  });

  test("returns null and is a no-op when no line is present", () => {
    setParams({ review: "abc" });
    expect(takeHeadingLine()).toBe(null);
    expect(new URLSearchParams(location.search).get("review")).toBe("abc");
  });
});
