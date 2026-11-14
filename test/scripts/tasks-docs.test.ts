import { describe, expect, test } from "bun:test";

import { docsBuildCommand, docsServeCommand, unbuiltPageLinks } from "@/tasks/docs.ts";

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
