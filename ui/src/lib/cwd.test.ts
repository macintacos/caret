import { describe, expect, test } from "bun:test";

import { homeRelative, middleCuts, shortCwd } from "$lib/cwd.ts";

describe("shortCwd", () => {
  test("shows a one-segment path in full", () => {
    expect(shortCwd("/tmp")).toBe("/tmp");
  });

  test("shows a two-segment path in full", () => {
    expect(shortCwd("/home/julian")).toBe("/home/julian");
  });

  test("collapses a deeper path to its last two segments", () => {
    expect(shortCwd("/home/julian/code/caret")).toBe("…/code/caret");
  });

  test("ignores leading and trailing slashes when counting segments", () => {
    expect(shortCwd("/a/b/")).toBe("/a/b/");
    expect(shortCwd("/a/b/c/")).toBe("…/b/c");
  });

  test("handles an empty string", () => {
    expect(shortCwd("")).toBe("");
  });
});

describe("homeRelative", () => {
  const home = "/Users/dev";

  test("writes a path inside home from ~", () => {
    expect(homeRelative("/Users/dev/wt/caret/plan-header", home)).toBe("~/wt/caret/plan-header");
  });

  test("writes home itself as ~", () => {
    expect(homeRelative("/Users/dev", home)).toBe("~");
  });

  test("keeps a path outside home absolute", () => {
    expect(homeRelative("/opt/work/proj", home)).toBe("/opt/work/proj");
  });

  test("keeps a sibling that only shares home's prefix absolute", () => {
    expect(homeRelative("/Users/devops/proj", home)).toBe("/Users/devops/proj");
  });

  test("leaves a path already written from ~ as it is", () => {
    expect(homeRelative("~/acme-web", home)).toBe("~/acme-web");
  });

  test("keeps the path absolute when home is unknown", () => {
    expect(homeRelative("/Users/dev/proj", undefined)).toBe("/Users/dev/proj");
  });

  test("never writes ~ for a root home", () => {
    expect(homeRelative("/srv/proj", "/")).toBe("/srv/proj");
  });

  test("matches a home given with a trailing slash", () => {
    expect(homeRelative("/Users/dev/proj", "/Users/dev/")).toBe("~/proj");
  });
});

describe("middleCuts", () => {
  test("drops whole segments after ~, nearest ~ first, keeping the leaf", () => {
    expect(middleCuts("~/wt/caret/plan-header")).toEqual([
      "~/wt/caret/plan-header",
      "~/…/caret/plan-header",
      "~/…/plan-header",
    ]);
  });

  test("keeps an absolute path's first directory with its root", () => {
    expect(middleCuts("/opt/work/proj/leaf")).toEqual([
      "/opt/work/proj/leaf",
      "/opt/…/proj/leaf",
      "/opt/…/leaf",
    ]);
  });

  test("offers only the whole path when no segment sits between the start and the leaf", () => {
    expect(middleCuts("~/acme-web")).toEqual(["~/acme-web"]);
    expect(middleCuts("/opt/proj")).toEqual(["/opt/proj"]);
    expect(middleCuts("/tmp")).toEqual(["/tmp"]);
    expect(middleCuts("~")).toEqual(["~"]);
  });
});
