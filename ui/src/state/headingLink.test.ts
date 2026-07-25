import "@ui/test-setup.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { headingSlug, setHeadingSlug, takeHeadingSlug } from "@/state/headingLink.ts";

// Set the URL's query params directly. happy-dom's base is about:blank and
// rejects a bare relative path, so build the href off the current location
// (the same shape setHeadingSlug writes).
function setParams(params: Record<string, string | null>) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value == null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  history.replaceState(null, "", url.href);
}

function clearUrl() {
  setParams({ review: null, heading: null });
}

beforeEach(clearUrl);
afterEach(clearUrl);

describe("headingSlug", () => {
  test("returns the slug from the `heading` param", () => {
    setParams({ heading: "tables" });
    expect(headingSlug()).toBe("tables");
  });

  test("returns null when no `heading` param is set", () => {
    expect(headingSlug()).toBe(null);
  });

  test("treats an empty or whitespace-only value as absent", () => {
    for (const blank of ["", "   "]) {
      setParams({ heading: blank });
      expect(headingSlug()).toBe(null);
    }
  });
});

describe("setHeadingSlug", () => {
  test("writes the heading param", () => {
    setHeadingSlug("code-blocks");
    expect(new URLSearchParams(location.search).get("heading")).toBe("code-blocks");
  });

  test("deletes the heading param on null", () => {
    setParams({ heading: "tables" });
    setHeadingSlug(null);
    expect(new URLSearchParams(location.search).get("heading")).toBe(null);
  });

  test("preserves the review param alongside heading", () => {
    setParams({ review: "abc" });
    setHeadingSlug("tables");
    const search = new URLSearchParams(location.search);
    expect(search.get("review")).toBe("abc");
    expect(search.get("heading")).toBe("tables");
  });

  test("clears the param for a blank slug", () => {
    setParams({ heading: "tables" });
    setHeadingSlug("   ");
    expect(new URLSearchParams(location.search).get("heading")).toBe(null);
  });
});

describe("takeHeadingSlug", () => {
  test("reads the slug once and clears the param", () => {
    setParams({ heading: "tables" });
    expect(takeHeadingSlug()).toBe("tables");
    expect(new URLSearchParams(location.search).get("heading")).toBe(null);
    // A second take after consumption yields null.
    expect(takeHeadingSlug()).toBe(null);
  });

  test("clearing the slug preserves the review param", () => {
    setParams({ review: "abc", heading: "tables" });
    expect(takeHeadingSlug()).toBe("tables");
    expect(new URLSearchParams(location.search).get("review")).toBe("abc");
    expect(new URLSearchParams(location.search).get("heading")).toBe(null);
  });

  test("returns null and is a no-op when no slug is present", () => {
    setParams({ review: "abc" });
    expect(takeHeadingSlug()).toBe(null);
    expect(new URLSearchParams(location.search).get("review")).toBe("abc");
  });
});
