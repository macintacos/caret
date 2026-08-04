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
// ("lines a–b of N"), the chunk loading that scrolling near either edge of the
// region triggers (EXC-969), the repaint that keeps the whole region in one
// palette across a theme switch, and the distinct too-large-to-preview state.
// The syntax highlighting itself is covered by the highlight unit test.
//
// happy-dom has no layout, so the code region's geometry is stubbed (see
// `stubLayout`) to give the proximity math something real to read. That covers
// which ranges get asked for and what lands in the region; whether a real
// scroll gesture reaches the threshold at all, and whether an upward load holds
// the reader's place, need actual layout and stay with the Playwright e2e.

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
 * preview; `failNext` makes the following request answer 500, standing in for a
 * chunk that never arrives. Echoes the requested path, so a reference change is
 * visible in the served body. The lines read as JSON so `language: "json"`
 * colours them.
 */
function serveWindowed(
  totalLines: number,
  headLines: number,
  language = "text",
): LogCapture & { urls: string[]; shrinkTo: (lines: number) => void; failNext: () => void } {
  const urls: string[] = [];
  const file = { total: totalLines };
  let fail = false;
  const cap = logCapture((url) => {
    if (!url.includes("/file?")) return Promise.resolve(new Response(null, { status: 204 }));
    urls.push(url);
    if (fail) {
      fail = false;
      return Promise.resolve(new Response(null, { status: 500 }));
    }
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
    failNext: () => {
      fail = true;
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

/** Pixels one rendered row occupies under the synthetic layout below. */
const ROW_PX = 20;
/** The stubbed viewport: 30 rows tall, so the derived step (2 screens = 60
 * lines) is comfortably larger than the 50-line floor and a range assertion can
 * tell the two apart. */
const VIEWPORT_PX = 30 * ROW_PX;

/**
 * Give the code region a synthetic layout and return a `scrollTo(top)` that
 * moves it and fires a real scroll event.
 *
 * happy-dom lays nothing out, so every geometry property the proximity math
 * reads is 0 and every edge would look reachable. Shadowing them with own
 * properties is enough — the element is real, only its layout is missing. The
 * height is a live getter off the rows actually rendered, deliberately not a
 * snapshot: a chunk that lands has to carry the edge back out of range, and a
 * frozen height would let the fill loop run forever.
 */
function stubLayout(target: HTMLElement): (top: number) => void {
  const region = target.querySelector(".fp-code") as HTMLElement;
  let scrollTop = 0;
  Object.defineProperty(region, "clientHeight", { get: () => VIEWPORT_PX, configurable: true });
  Object.defineProperty(region, "scrollHeight", {
    get: () => region.querySelectorAll(".fp-row").length * ROW_PX,
    configurable: true,
  });
  Object.defineProperty(region, "scrollTop", {
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next;
    },
    configurable: true,
  });
  return (top: number) => {
    scrollTop = top;
    region.dispatchEvent(new Event("scroll"));
  };
}

/** Scroll to the region's last full screen — within the threshold of its
 * bottom edge, whatever the region currently holds. */
function scrollToBottom(target: HTMLElement, scrollTo: (top: number) => void): void {
  const region = target.querySelector(".fp-code") as HTMLElement;
  scrollTo(region.scrollHeight - region.clientHeight);
}

/** The `start`/`end` of the last range asked for, as a `start=a&end=b` fragment. */
const lastRange = (urls: string[]) => {
  const params = new URLSearchParams((urls.at(-1) ?? "").split("?")[1] ?? "");
  return `start=${params.get("start")}&end=${params.get("end")}`;
};

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

  test("a one-line file reads in the singular", async () => {
    cap = serveExcerpt(excerptFixture(1, 1, 1));
    const { target } = render(FilePreview, props());
    await until(() => target.querySelector(".fp-range") != null);
    expect(target.querySelector(".fp-range")?.textContent?.trim()).toBe("1 line");
  });

  test("nothing at the boundaries offers to load more", async () => {
    // EXC-969 removed the "N lines above/below" strips: proximity loads the next
    // chunk, so a control there would be clutter that still looks clickable.
    cap = serveExcerpt(excerptFixture(25, 25, 122)); // 24 above, 73 below
    const { target } = render(FilePreview, props({ line: 37 }));
    await until(() => target.querySelector(".fp-lnum") != null);
    expect(target.querySelectorAll("button")).toHaveLength(0);
    expect(target.querySelector(".fp-edge")).toBeNull();
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

describe("FilePreview scroll loading", () => {
  test("scrolling within the region, away from both edges, loads nothing", async () => {
    // The threshold is a quarter screen. A reader moving around inside what is
    // already loaded is not asking for more file, and a slacker threshold would
    // spend a round trip on every such move — and would reach both ends of a
    // freshly opened window at once.
    const served = serveWindowed(600, 180);
    cap = served;
    // Window 210–389: 180 rows (6 screens) with file on both sides.
    const { target } = render(FilePreview, props({ line: 300 }));
    await until(() => target.querySelector(".fp-code") != null);
    const scrollTo = stubLayout(target);

    // Half a screen short of the bottom — well inside a half-screen threshold,
    // outside a quarter-screen one.
    scrollTo(180 * ROW_PX - VIEWPORT_PX - 0.5 * VIEWPORT_PX);
    await until(() => served.urls.length > 1, 200);
    expect(served.urls).toHaveLength(1);
    expect(lineNumbers(target)).toHaveLength(180);

    // …and the same gesture continued to the edge does load.
    scrollToBottom(target, scrollTo);
    await until(() => lineNumbers(target).length > 180);
    expect(lastRange(served.urls)).toBe("start=390&end=449");
  });

  test("scrolling near the bottom appends the next chunk, fetching only its lines", async () => {
    const served = serveWindowed(300, 60);
    cap = served;
    const { target } = render(FilePreview, props());
    await until(() => target.querySelector(".fp-code") != null);
    const scrollTo = stubLayout(target);

    scrollToBottom(target, scrollTo);
    await until(() => lineNumbers(target).length > 60);

    // Only the lines past the window are asked for; the 60 already on screen are
    // not refetched, so a step costs the same whether it is the first or the
    // fortieth. The step is two screens (2 × 30 rows), not the 50-line floor —
    // one screen of scrolling must not cost several round trips.
    expect(lastRange(served.urls)).toBe("start=61&end=120");
    // …and the chunk lands under what was already there, not in place of it.
    expect(lineNumbers(target)).toHaveLength(120);
    expect(lineNumbers(target)[0]).toBe("1");
    expect(lineNumbers(target).at(-1)).toBe("120");
    expect(target.querySelector(".fp-range")?.textContent?.trim()).toBe("lines 1–120 of 300");
  });

  test("scrolling near the top prepends the chunk above, fetching only its lines", async () => {
    const served = serveWindowed(300, 60);
    cap = served;
    // Centred on line 100, so the opening window is 70–129 with file on both sides.
    const { target } = render(FilePreview, props({ line: 100 }));
    await until(() => target.querySelector(".fp-code") != null);
    const scrollTo = stubLayout(target);
    expect(lineNumbers(target)[0]).toBe("70");

    scrollTo(0);
    await until(() => lineNumbers(target).length > 60);

    expect(lastRange(served.urls)).toBe("start=10&end=69");
    expect(lineNumbers(target)).toHaveLength(120);
    expect(lineNumbers(target)[0]).toBe("10");
    expect(lineNumbers(target).at(-1)).toBe("129");
  });

  test("one landed chunk carries the edge out of range instead of cascading", async () => {
    // The step is deliberately larger than the threshold, so a gesture costs one
    // round trip. A step at or under the threshold would leave the edge still
    // near after the chunk landed and walk the whole file on one scroll.
    const served = serveWindowed(300, 60);
    cap = served;
    const { target } = render(FilePreview, props());
    await until(() => target.querySelector(".fp-code") != null);
    const scrollTo = stubLayout(target);

    scrollToBottom(target, scrollTo);
    await until(() => lineNumbers(target).length > 60);
    await until(() => served.urls.length > 2, 200);
    expect(served.urls).toHaveLength(2);
  });

  test("overlapping scrolls do not stack duplicate requests for the same range", async () => {
    const served = serveWindowed(300, 60);
    cap = served;
    const { target } = render(FilePreview, props());
    await until(() => target.querySelector(".fp-code") != null);
    const scrollTo = stubLayout(target);

    // A flurry of scroll events — a real wheel gesture emits many — while the
    // first chunk is still in flight.
    scrollToBottom(target, scrollTo);
    scrollToBottom(target, scrollTo);
    scrollToBottom(target, scrollTo);
    await until(() => lineNumbers(target).length > 60);

    expect(served.urls.filter((url) => url.includes("start=61"))).toHaveLength(1);
    expect(lineNumbers(target)).toHaveLength(120);
  });

  test("the region stops asking once its side reaches the end of the file", async () => {
    // 70 lines with a 60-line opening window: one downward step covers the rest.
    const served = serveWindowed(70, 60);
    cap = served;
    const { target } = render(FilePreview, props());
    await until(() => target.querySelector(".fp-code") != null);
    const scrollTo = stubLayout(target);

    scrollToBottom(target, scrollTo);
    await until(() => lineNumbers(target).length === 70);
    expect(target.querySelector(".fp-range")?.textContent?.trim()).toBe("70 lines");

    const settled = served.urls.length;
    scrollToBottom(target, scrollTo);
    scrollTo(0);
    await until(() => served.urls.length > settled, 200);
    expect(served.urls).toHaveLength(settled);
  });

  test("a file that shrank under the preview stops instead of repeating lines", async () => {
    // The daemon clamps a range to the file, so a file edited down to fewer lines
    // than the region already holds answers with a line that is already on screen.
    // Appending it would put the same line number in two rows, which Svelte's
    // keyed each throws on; the count it reports is what retires that side.
    const served = serveWindowed(300, 60);
    cap = served;
    const { target } = render(FilePreview, props());
    await until(() => target.querySelector(".fp-code") != null);
    const scrollTo = stubLayout(target);
    served.shrinkTo(60);

    scrollToBottom(target, scrollTo);
    await until(() => target.querySelector(".fp-range")?.textContent?.trim() === "60 lines");
    const nums = lineNumbers(target);
    expect(nums).toHaveLength(60);
    expect(new Set(nums).size).toBe(60);
  });

  test("a failed chunk keeps the loaded rows, and scrolling again retries", async () => {
    // Nothing at the boundary is clickable any more, so the scroll gesture is the
    // retry affordance — a failure that dead-ended the region would strand the
    // reader with no way back.
    const served = serveWindowed(300, 60);
    cap = served;
    const { target } = render(FilePreview, props());
    await until(() => target.querySelector(".fp-code") != null);
    const scrollTo = stubLayout(target);
    served.failNext();

    scrollToBottom(target, scrollTo);
    await until(() => served.urls.length === 2);
    // The rows already on screen survive the failure; the panel never blanks.
    expect(lineNumbers(target)).toHaveLength(60);
    expect(target.querySelector('[data-preview-state="error"]')).toBeNull();

    // Scrolling again is the retry, and a reader scrolls continuously — each
    // event is a fresh chance, so the region must take one of them.
    await until(() => {
      scrollToBottom(target, scrollTo);
      return lineNumbers(target).length > 60;
    });
    expect(lineNumbers(target)).toHaveLength(120);
    expect(lineNumbers(target).at(-1)).toBe("120");
  });

  test("a new reference discards the chunks the previous one accumulated", async () => {
    cap = serveWindowed(300, 60);
    // The parent reuses one instance across references, so the accumulated span
    // has to go with the old one rather than framing the new file.
    const live = reactiveProps({ reviewId: ID, path: "src/cache.ts" });
    const { target, flush } = render(FilePreview, live);
    await until(() => target.querySelector(".fp-code") != null);
    const scrollTo = stubLayout(target);
    scrollToBottom(target, scrollTo);
    await until(() => lineNumbers(target).length === 120);

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
    const scrollTo = stubLayout(target);
    scrollToBottom(target, scrollTo);
    await until(() => lineNumbers(target).length === 120);
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
