import "@ui/test-mount.ts";
import { afterEach, describe, expect, test } from "bun:test";

import type { FileExcerpt } from "@core/lib/types";
import { until } from "@test/support/poll.ts";
import { type LogCapture, logCapture } from "@ui/test-helpers.ts";
import { render } from "@ui/test-mount.ts";
import FilePreview from "@/components/FilePreview.svelte";

// The filename-hover preview (EXC-687) shows a bounded excerpt of a referenced
// file. These pin the reader affordances layered on top of the highlighted code:
// per-line numbers off the file's real line offset, a header that frames it as a
// slice ("lines a–b of N"), and muted boundary strips that say how much file sits
// above/below the window — so the reader always knows they're seeing an excerpt.
// The syntax highlighting itself and the real pointer wiring are covered by the
// highlight unit test and the Playwright e2e.

const ID = "r1";

// A throwaway anchor rect; happy-dom has no layout, so placement is a no-op here.
const anchor = {
  left: 20,
  top: 120,
  right: 80,
  bottom: 136,
  width: 60,
  height: 16,
  x: 20,
  y: 120,
  toJSON: () => ({}),
} as DOMRect;

function props(over: Partial<{ path: string; line: number }> = {}) {
  return {
    reviewId: ID,
    path: over.path ?? "src/cache.ts",
    line: over.line,
    anchor,
  };
}

/** Install a fetch double that answers the excerpt endpoint with `excerpt`. */
function serveExcerpt(excerpt: FileExcerpt): LogCapture {
  return logCapture((url) => {
    if (url.includes("/file?")) {
      return Promise.resolve(
        new Response(JSON.stringify(excerpt), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  });
}

/** An excerpt of `count` lines starting at `startLine` in a `totalLines` file. */
function excerptFixture(startLine: number, count: number, totalLines: number): FileExcerpt {
  return {
    path: "src/cache.ts",
    language: "text",
    startLine,
    endLine: startLine + count - 1,
    totalLines,
    lines: Array.from(
      { length: count },
      (_, i) => `const line${startLine + i} = ${startLine + i};`,
    ),
  };
}

let cap: LogCapture | undefined;
afterEach(() => {
  cap?.restore();
  cap = undefined;
});

const lineNumbers = (target: HTMLElement) =>
  [...target.querySelectorAll(".fp-lnum")].map((e) => e.textContent?.trim());

describe("FilePreview line numbers", () => {
  test("numbers each line from the excerpt's real file offset", async () => {
    cap = serveExcerpt(excerptFixture(25, 5, 122));
    const { target } = render(FilePreview, props({ line: 30 }));
    await until(() => target.querySelector(".fp-lnum") != null);
    expect(lineNumbers(target)).toEqual(["25", "26", "27", "28", "29"]);
  });

  test("a head preview numbers from line 1", async () => {
    cap = serveExcerpt(excerptFixture(1, 4, 80));
    const { target } = render(FilePreview, props());
    await until(() => target.querySelector(".fp-lnum") != null);
    expect(lineNumbers(target)).toEqual(["1", "2", "3", "4"]);
  });

  test("syntax-highlights each line while keeping the numbers aligned", async () => {
    // A real grammar so shiki emits colored token spans; each line's tokens must
    // render in its own numbered row, not as one undivided block.
    cap = serveExcerpt({
      path: "config.json",
      language: "json",
      startLine: 3,
      endLine: 4,
      totalLines: 9,
      lines: ['  "port": 8080,', '  "debug": true'],
    });
    const { target } = render(FilePreview, props({ path: "config.json" }));
    await until(() => target.querySelector(".fp-lcode span") != null);
    expect(lineNumbers(target)).toEqual(["3", "4"]);
    // The code carries shiki's per-token color spans, not plain text.
    expect(target.querySelectorAll('.fp-lcode span[style*="color"]').length).toBeGreaterThan(0);
    // The rendered code still reads back as the file's text.
    const code = [...target.querySelectorAll(".fp-lcode")].map((e) => e.textContent).join("\n");
    expect(code).toContain("port");
    expect(code).toContain("8080");
  });
});

describe("FilePreview target line", () => {
  test("marks the referenced line so it stands out", async () => {
    // Window 25–49; the referenced line 37 sits inside it and is the one marked.
    cap = serveExcerpt(excerptFixture(25, 25, 122));
    const { target } = render(FilePreview, props({ line: 37 }));
    await until(() => target.querySelector(".fp-target") != null);
    const marked = target.querySelectorAll(".fp-target");
    expect(marked).toHaveLength(1);
    expect(marked[0]?.querySelector(".fp-lnum")?.textContent?.trim()).toBe("37");
  });

  test("highlights nothing for a head preview with no line", async () => {
    cap = serveExcerpt(excerptFixture(1, 10, 80));
    const { target } = render(FilePreview, props());
    await until(() => target.querySelector(".fp-row") != null);
    expect(target.querySelector(".fp-target")).toBeNull();
  });
});

describe("FilePreview snippet framing", () => {
  test("the header frames the window as a slice of the whole file", async () => {
    cap = serveExcerpt(excerptFixture(25, 25, 122));
    const { target } = render(FilePreview, props({ line: 37 }));
    await until(() => target.querySelector(".fp-range")?.textContent?.includes("of") ?? false);
    expect(target.querySelector(".fp-range")?.textContent?.trim()).toBe("lines 25–49 of 122");
  });

  test("a whole-file preview reads as the full file, not a slice", async () => {
    cap = serveExcerpt(excerptFixture(1, 10, 10));
    const { target } = render(FilePreview, props());
    await until(() => target.querySelector(".fp-range") != null);
    expect(target.querySelector(".fp-range")?.textContent?.trim()).toBe("10 lines");
  });
});

describe("FilePreview excerpt boundaries", () => {
  test("shows how much file sits above and below a mid-file window", async () => {
    cap = serveExcerpt(excerptFixture(25, 25, 122)); // 24 above, 73 below
    const { target } = render(FilePreview, props({ line: 37 }));
    await until(() => target.querySelector(".fp-edge-top") != null);
    const top = target.querySelector(".fp-edge-top")?.textContent ?? "";
    const bottom = target.querySelector(".fp-edge-bottom")?.textContent ?? "";
    expect(top).toContain("24");
    expect(top).toContain("above");
    expect(bottom).toContain("73");
    expect(bottom).toContain("below");
  });

  test("no top strip for a head preview; a bottom strip still shows the remainder", async () => {
    cap = serveExcerpt(excerptFixture(1, 24, 122)); // 0 above, 98 below
    const { target } = render(FilePreview, props());
    await until(() => target.querySelector(".fp-edge-bottom") != null);
    expect(target.querySelector(".fp-edge-top")).toBeNull();
    expect(target.querySelector(".fp-edge-bottom")?.textContent).toContain("98");
  });

  test("no boundary strips when the excerpt is the whole file", async () => {
    cap = serveExcerpt(excerptFixture(1, 10, 10));
    const { target } = render(FilePreview, props());
    await until(() => target.querySelector(".fp-lnum") != null);
    expect(target.querySelector(".fp-edge-top")).toBeNull();
    expect(target.querySelector(".fp-edge-bottom")).toBeNull();
  });

  test("singular wording when exactly one line sits beyond the window", async () => {
    cap = serveExcerpt(excerptFixture(2, 9, 10)); // 1 above, 0 below
    const { target } = render(FilePreview, props({ line: 2 }));
    await until(() => target.querySelector(".fp-edge-top") != null);
    expect(target.querySelector(".fp-edge-top")?.textContent).toContain("1 line above");
    expect(target.querySelector(".fp-edge-bottom")).toBeNull();
  });
});
