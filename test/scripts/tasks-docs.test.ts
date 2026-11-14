import { describe, expect, test } from "bun:test";

import {
  docsBuildCommand,
  docsServeCommand,
  unbuiltPageLinks,
  unbuiltPageReport,
} from "@/tasks/docs.ts";

describe("docs task argv", () => {
  test("build runs a clean, strict zensical build from the lockfile", () => {
    expect(docsBuildCommand()).toEqual([
      "uv",
      "run",
      "--locked",
      "zensical",
      "build",
      "--clean",
      "--strict",
    ]);
  });

  test("serve binds localhost:2273 and forwards extra args", () => {
    const base = ["uv", "run", "--locked", "zensical", "serve", "--dev-addr", "localhost:2273"];
    expect(docsServeCommand([])).toEqual(base);
    expect(docsServeCommand(["--open"])).toEqual([...base, "--open"]);
  });
});

describe("unbuiltPageLinks", () => {
  test("finds site-internal hrefs still ending in .md", () => {
    const html =
      '<a href="./explanation/missing.md">a</a><a href="../x.md#frag">b</a>' +
      '<a href="/caret/CONFIGURING.md">c</a>';
    expect(unbuiltPageLinks(html)).toEqual([
      "./explanation/missing.md",
      "../x.md#frag",
      "/caret/CONFIGURING.md",
    ]);
  });

  test("ignores built pages, fragments, and external .md links", () => {
    const html =
      '<a href="./tutorial/">a</a><a href="#top">b</a>' +
      '<a href="https://github.com/macintacos/caret/blob/main/docs/CONFIGURING.md">c</a>';
    expect(unbuiltPageLinks(html)).toEqual([]);
  });
});

describe("unbuiltPageReport", () => {
  const clean = { page: "index.html", html: '<a href="./tutorial/">a</a>' };

  test("passes a site whose links all resolve to built pages", () => {
    expect(unbuiltPageReport([clean])).toBeNull();
  });

  test("names the first offending page and its unbuilt links", () => {
    const bad = { page: "a/index.html", html: '<a href="./x.md">x</a><a href="../y.md">y</a>' };
    expect(unbuiltPageReport([clean, bad])).toBe(
      "docs:build: site/a/index.html links pages the build did not produce: ./x.md, ../y.md. " +
        "Check zensical.toml's nav for a missing or excluded page.",
    );
  });

  test("counts the other offending pages", () => {
    const bad = (page: string) => ({ page, html: '<a href="./x.md">x</a>' });
    expect(unbuiltPageReport([bad("a.html"), bad("b.html"), bad("c.html")])).toContain(
      "(and 2 more pages do too)",
    );
  });

  test("fails a site with no pages, since it checked nothing", () => {
    expect(unbuiltPageReport([])).toContain("site/");
  });
});
