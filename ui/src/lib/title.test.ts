import { describe, expect, test } from "bun:test";

import { stripTitleLinks } from "$lib/title.ts";

describe("stripTitleLinks", () => {
  test("leaves a link-free title unchanged", () => {
    expect(stripTitleLinks("Widget Cache Refactor")).toBe("Widget Cache Refactor");
  });

  test("strips a markdown link in the middle of a title to its text", () => {
    expect(
      stripTitleLinks(
        "Triage analysis to post — [EXC-562](https://linear.app/macintacos/issue/EXC-562)",
      ),
    ).toBe("Triage analysis to post — EXC-562");
  });

  test("strips a title that is entirely a link", () => {
    expect(stripTitleLinks("[EXC-562](https://example.com/x)")).toBe("EXC-562");
  });

  test("strips every link when a title has more than one", () => {
    expect(stripTitleLinks("[A](https://a.test) then [B](https://b.test)")).toBe("A then B");
  });

  test("strips a link whose URL contains balanced parentheses", () => {
    expect(stripTitleLinks("See [Foo](https://example.com/wiki/Foo_(bar)) now")).toBe(
      "See Foo now",
    );
  });

  test("handles an empty string", () => {
    expect(stripTitleLinks("")).toBe("");
  });
});
