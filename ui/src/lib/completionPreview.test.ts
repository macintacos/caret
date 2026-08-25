import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import type { FileExcerpt } from "@core/lib/types";
import {
  createPreviewToggle,
  previewPanel,
  previewToggle,
  renderExcerptLines,
} from "$lib/completionPreview.ts";

// The shared half of the Ctrl+Space preview (EXC-1186): the toggle both
// completion sources read at query time, and the panel DOM they fill. All of it
// is plain state and plain DOM, so happy-dom exercises it fully; whether
// CodeMirror then MOUNTS the panel beside the list is the library's own concern.

describe("createPreviewToggle", () => {
  test("starts closed, so a list opens as it always did", () => {
    expect(createPreviewToggle().on()).toBe(false);
  });

  test("a toggle opens it and a second one closes it", () => {
    const toggle = createPreviewToggle();
    toggle.toggle();
    expect(toggle.on()).toBe(true);
    toggle.toggle();
    expect(toggle.on()).toBe(false);
  });

  test("stays open across reads, so the next list previews too", () => {
    const toggle = createPreviewToggle();
    toggle.toggle();
    expect(toggle.on()).toBe(true);
    expect(toggle.on()).toBe(true);
  });

  test("a fresh toggle neither reads from nor leaks into the module's", () => {
    // The seam that keeps a unit's state out of the app's — the same reason
    // `createSkillCache` sits beside `skillsFor`.
    const mine = createPreviewToggle();
    mine.toggle();
    expect(mine.on()).toBe(true);
    expect(previewToggle.on()).toBe(false);
  });
});

describe("previewPanel", () => {
  test("the title names what is being previewed", () => {
    const { dom } = previewPanel("src/lib/foo.ts");
    expect(dom.textContent).toContain("src/lib/foo.ts");
  });

  test("the body is inside the panel and starts empty, so the row paints at once", () => {
    // `info` returns synchronously — the panel is handed over before its content
    // is known, and filled in when the answer lands.
    const { dom, body } = previewPanel("src/lib/foo.ts");
    expect(dom.contains(body)).toBe(true);
    expect(body.textContent).toBe("");
  });

  test("the class names the theme hangs off are what it builds", () => {
    // Pinned because the CSS lives in markdownEditor.ts's theme block: a rename
    // here silently unstyles the panel rather than failing anything.
    const { dom, body } = previewPanel("x");
    expect(dom.className).toBe("caret-preview");
    expect(body.className).toBe("caret-preview-body");
    expect(dom.querySelector(".caret-preview-title")?.textContent).toBe("x");
  });
});

describe("renderExcerptLines", () => {
  const EXCERPT: FileExcerpt = {
    path: "src/lib/foo.ts",
    language: "typescript",
    startLine: 40,
    endLine: 43,
    lines: ["const a = 1;", "  const b = 2;", "", "const c = 3;"],
    totalLines: 900,
  };

  /** Each rendered row as the reviewer reads it: its number and its source. */
  function rows(excerpt: FileExcerpt, mark?: number): Array<[string, string]> {
    const body = document.createElement("div");
    renderExcerptLines(body, excerpt, mark);
    return [...body.querySelectorAll(".caret-preview-line")].map((row) => [
      row.querySelector(".caret-preview-lineno")?.textContent ?? "",
      row.textContent?.slice(row.querySelector(".caret-preview-lineno")?.textContent?.length) ?? "",
    ]);
  }

  test("numbers run from the excerpt's own first line, not from one", () => {
    expect(rows(EXCERPT).map(([n]) => n)).toEqual(["40", "41", "42", "43"]);
  });

  test("each line's text is rendered as it is on disk, indentation included", () => {
    expect(rows(EXCERPT).map(([, text]) => text)).toEqual([
      "const a = 1;",
      "  const b = 2;",
      "",
      "const c = 3;",
    ]);
  });

  test("the cited line is the one that wears the mark", () => {
    const body = document.createElement("div");
    renderExcerptLines(body, EXCERPT, 42);
    const marked = [...body.querySelectorAll(".caret-preview-marked")];
    expect(marked).toHaveLength(1);
    expect(marked[0]?.querySelector(".caret-preview-lineno")?.textContent).toBe("42");
  });

  test("no cited line marks nothing", () => {
    const body = document.createElement("div");
    renderExcerptLines(body, EXCERPT);
    expect(body.querySelectorAll(".caret-preview-marked")).toHaveLength(0);
  });

  test("a cited line the excerpt does not reach marks nothing", () => {
    // Reachable: the daemon clamps a range that runs past the end of a file, so a
    // reviewer citing line 4000 of a 900-line file gets the file's tail back with
    // the line they named nowhere in it.
    const body = document.createElement("div");
    renderExcerptLines(body, EXCERPT, 4000);
    expect(body.querySelectorAll(".caret-preview-line")).toHaveLength(4);
    expect(body.querySelectorAll(".caret-preview-marked")).toHaveLength(0);
  });

  test("a line past the end of the file says so, rather than showing a tail unexplained", () => {
    const body = document.createElement("div");
    renderExcerptLines(body, EXCERPT, 4000);
    expect(body.querySelector(".caret-preview-note")?.textContent).toBe(
      "This file ends at line 900.",
    );
  });

  test("a line the file does reach adds no note", () => {
    const body = document.createElement("div");
    renderExcerptLines(body, EXCERPT, 42);
    expect(body.querySelector(".caret-preview-note")).toBeNull();
  });
});
