import "@ui/test-mount.ts";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import type { FileExcerpt } from "@core/lib/types";
import { until } from "@test/support/poll.ts";
import { type LogCapture, logCapture } from "@ui/test-helpers.ts";
import { render } from "@ui/test-mount.ts";
import { reactiveProps } from "@ui/test-props.svelte.ts";
import FilePreview from "@/components/FilePreview.svelte";
import { appearance } from "@/state/appearance.svelte.ts";
import { highlightChunk } from "$lib/diffview/highlight.ts";

// The filename preview (EXC-687) shows an excerpt of a referenced file. These
// pin the reader affordances layered on top of the highlighted code: per-line
// numbers off the file's real line offset, a header that frames it as a slice
// ("lines a–b of N"), boundary strips that say how much file sits above/below
// the loaded region and load the next chunk toward those ends on click, the
// repaint that keeps the whole region in one palette across a theme switch, and
// the distinct too-large-to-preview state. The syntax highlighting itself and
// everything that needs real layout (scroll anchoring, the height cap) are
// covered by the highlight unit test and the Playwright e2e.

const ID = "r1";

function props(over: Partial<{ path: string; line: number }> = {}) {
  return {
    reviewId: ID,
    path: over.path ?? "src/cache.ts",
    line: over.line,
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

/** Install a fetch double that answers every excerpt request with `status`. */
function serveStatus(status: number): LogCapture {
  return logCapture((url) =>
    Promise.resolve(new Response(null, { status: url.includes("/file?") ? status : 204 })),
  );
}

/**
 * Install a fetch double that serves a slice of a `totalLines`-line file for
 * whatever window the card asks for, recording each requested URL. With neither
 * a range nor a line it answers the opening window `[1, headLines]`; a bare
 * `line` is centred in a `headLines` window; an explicit `start`/`end` is
 * clamped to the file exactly as `readFileExcerpt` clamps it, so a range past a
 * shrunk file comes back as its last line rather than as nothing. `shrinkTo`
 * moves the file's line count mid-test, standing in for an edit under an open
 * preview. Echoes the requested path, so a reference change is visible in the
 * served body. The lines read as JSON so `language: "json"` colours them.
 */
function serveWindowed(
  totalLines: number,
  headLines: number,
  language = "text",
): LogCapture & { urls: string[]; shrinkTo: (lines: number) => void } {
  const urls: string[] = [];
  const file = { total: totalLines };
  const cap = logCapture((url) => {
    if (!url.includes("/file?")) return Promise.resolve(new Response(null, { status: 204 }));
    urls.push(url);
    const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    const rawStart = params.get("start");
    const rawEnd = params.get("end");
    const rawLine = params.get("line");
    const startLine =
      rawStart !== null
        ? Math.min(Math.max(1, Number(rawStart)), file.total)
        : rawLine !== null
          ? Math.max(1, Number(rawLine) - Math.floor(headLines / 2))
          : 1;
    const endLine =
      rawEnd === null
        ? Math.min(file.total, startLine + headLines - 1)
        : Math.min(file.total, Math.max(Number(rawEnd), startLine));
    const body: FileExcerpt = {
      path: params.get("path") ?? "src/cache.ts",
      language,
      startLine,
      endLine,
      totalLines: file.total,
      lines: Array.from(
        { length: endLine - startLine + 1 },
        (_, i) => `  "line": ${startLine + i},`,
      ),
    };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  return Object.assign(cap, {
    urls,
    shrinkTo: (lines: number) => {
      file.total = lines;
    },
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

/** Each rendered line's token colours, joined — the signature a repaint moves. */
const rowColours = (target: HTMLElement) =>
  [...target.querySelectorAll(".fp-lcode")].map((row) =>
    [...row.querySelectorAll("span")].map((s) => s.getAttribute("style")).join("|"),
  );

const clickStrip = (target: HTMLElement, side: "top" | "bottom") =>
  (target.querySelector(`.fp-edge-${side}`) as HTMLButtonElement).click();

// shiki compiles a grammar's patterns lazily, at first tokenize, and that cost
// counts against its 500ms per-line limit — enough for a cold grammar to bail
// mid-line and leave the rest unstyled. Pay it up front, so a colour assertion
// below measures the repaint rather than who tokenized first.
beforeAll(async () => {
  await highlightChunk('  "line": 1,', "json", appearance.themeId);
});

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

describe("FilePreview load failures", () => {
  test("a file too large to preview reads as its own state, not a load failure", async () => {
    cap = serveStatus(413);
    const { target } = render(FilePreview, props());
    await until(() => target.querySelector('[data-preview-state="too-large"]') != null);
    expect(target.querySelector(".fp-message")?.textContent).toContain("too large");
    expect(target.querySelector('[data-preview-state="error"]')).toBeNull();
  });

  test("any other failure still reads as a load failure", async () => {
    cap = serveStatus(404);
    const { target } = render(FilePreview, props());
    await until(() => target.querySelector('[data-preview-state="error"]') != null);
    expect(target.querySelector('[data-preview-state="too-large"]')).toBeNull();
  });
});

describe("FilePreview expansion", () => {
  test("the boundary strips are controls, not labels", async () => {
    cap = serveWindowed(300, 60);
    const { target } = render(FilePreview, props());
    await until(() => target.querySelector(".fp-edge-bottom") != null);
    const bottom = target.querySelector(".fp-edge-bottom");
    expect(bottom?.tagName).toBe("BUTTON");
    // The accessible name says what the click does, and it still contains the
    // visible label — speech input activates a control by what it reads
    // (WCAG 2.5.3 label-in-name), so the two must not diverge.
    const name = bottom?.getAttribute("aria-label") ?? "";
    expect(name).toContain("show 50 more");
    expect(name).toContain((bottom?.textContent ?? "").replace("↓ ", "").trim());
  });

  test("clicking a strip appends the next chunk, fetching only its lines", async () => {
    const served = serveWindowed(300, 60);
    cap = served;
    const { target } = render(FilePreview, props());
    await until(() => target.querySelector(".fp-edge-bottom") != null);
    expect(target.querySelector(".fp-edge-bottom")?.textContent).toContain("240");

    clickStrip(target, "bottom");
    await until(() => lineNumbers(target).length > 60);

    // Only the lines past the window are asked for; the 60 already on screen are
    // not refetched, so a step costs the same whether it is the first or the
    // fortieth.
    const last = served.urls.at(-1) ?? "";
    expect(last).toContain("start=61");
    expect(last).toContain("end=110");
    // …and the chunk lands under what was already there, not in place of it.
    expect(lineNumbers(target)).toHaveLength(110);
    expect(lineNumbers(target)[0]).toBe("1");
    expect(lineNumbers(target).at(-1)).toBe("110");
    expect(target.querySelector(".fp-edge-bottom")?.textContent).toContain("190");
  });

  test("clicking the top strip prepends the chunk above, fetching only its lines", async () => {
    const served = serveWindowed(300, 60);
    cap = served;
    // Centred on line 100, so the opening window is 70–129 with file on both sides.
    const { target } = render(FilePreview, props({ line: 100 }));
    await until(() => target.querySelector(".fp-edge-top") != null);
    expect(lineNumbers(target)[0]).toBe("70");

    clickStrip(target, "top");
    await until(() => lineNumbers(target).length > 60);

    const last = served.urls.at(-1) ?? "";
    expect(last).toContain("start=20");
    expect(last).toContain("end=69");
    expect(lineNumbers(target)).toHaveLength(110);
    expect(lineNumbers(target)[0]).toBe("20");
    expect(lineNumbers(target).at(-1)).toBe("129");
  });

  test("a strip disappears once its side reaches the end of the file", async () => {
    // 70 lines with a 60-line opening window: one downward step covers the rest.
    const served = serveWindowed(70, 60);
    cap = served;
    const { target } = render(FilePreview, props());
    await until(() => target.querySelector(".fp-edge-bottom") != null);
    clickStrip(target, "bottom");
    await until(() => target.querySelector(".fp-edge-bottom") == null);
    expect(lineNumbers(target).at(-1)).toBe("70");
    expect(target.querySelector(".fp-edge-top")).toBeNull();
  });

  test("a file that shrank under the preview retires the strip instead of repeating lines", async () => {
    // The daemon clamps a range to the file, so a file edited down to fewer lines
    // than the region already holds answers with a line that is already on screen.
    // Appending it would put the same line number in two rows, which Svelte's
    // keyed each throws on; the count it reports is what retires the strip.
    const served = serveWindowed(300, 60);
    cap = served;
    const { target } = render(FilePreview, props());
    await until(() => target.querySelector(".fp-edge-bottom") != null);
    served.shrinkTo(60);

    clickStrip(target, "bottom");
    await until(() => target.querySelector(".fp-edge-bottom") == null);
    const nums = lineNumbers(target);
    expect(nums).toHaveLength(60);
    expect(new Set(nums).size).toBe(60);
    expect(target.querySelector(".fp-range")?.textContent?.trim()).toBe("60 lines");
  });

  test("a new reference discards the chunks the previous one accumulated", async () => {
    cap = serveWindowed(300, 60);
    // The parent reuses one instance across references, so the accumulated span
    // has to go with the old one rather than framing the new file.
    const live = reactiveProps({ reviewId: ID, path: "src/cache.ts" });
    const { target, flush } = render(FilePreview, live);
    await until(() => target.querySelector(".fp-edge-bottom") != null);
    clickStrip(target, "bottom");
    await until(() => lineNumbers(target).length === 110);

    live.path = "src/other.ts";
    flush();
    await until(() => lineNumbers(target).length === 60);
    expect(lineNumbers(target)).toHaveLength(60);
    expect(lineNumbers(target).at(-1)).toBe("60");
    expect(target.querySelector(".fp-path")?.textContent).toBe("src/other.ts");
  });
});

describe("FilePreview theme changes", () => {
  const mode = appearance.mode;
  const slot = appearance.slots.light;
  afterEach(() => {
    appearance.setSlot("light", slot);
    appearance.setMode(mode);
  });

  test("a theme switch repaints every loaded chunk, not just the newest", async () => {
    appearance.setMode("light");
    appearance.setSlot("light", "caret-light");
    const served = serveWindowed(300, 60, "json");
    cap = served;
    const { target } = render(FilePreview, props());
    await until(() => target.querySelector(".fp-lcode span") != null);
    clickStrip(target, "bottom");
    await until(() => lineNumbers(target).length === 110);
    const before = rowColours(target);
    const fetches = served.urls.length;
    expect(before[0]).toContain("color");

    appearance.setSlot("light", "github-light");
    await until(() => rowColours(target)[0] !== before[0]);

    // Every row moved to the new palette — repainting only the newest chunk would
    // leave the first sixty in the old one, and the panel half a theme behind.
    const after = rowColours(target);
    expect(after).toHaveLength(before.length);
    for (const [i, colours] of after.entries()) expect(colours).not.toBe(before[i]);
    // The raw text was already here; recolouring it costs no round trip.
    expect(served.urls).toHaveLength(fetches);
  });
});
