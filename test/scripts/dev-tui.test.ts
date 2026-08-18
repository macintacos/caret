// The dev task's split-pane terminal UI: a fixed shortcut rail on the left, the
// live log tail on the right. Everything here is the pure half — measuring and
// wrapping ANSI-coloured text, laying out one frame, and clamping the scroll
// offset — so the layout is checked without a terminal. The runtime shell it
// feeds (alternate screen, raw keys, SIGWINCH) is thin wiring over these.

import { describe, expect, test } from "bun:test";

import {
  clampOffset,
  createTui,
  keyAction,
  MAX_LOG_LINES,
  renderFrame,
  splitKeys,
  visibleWidth,
  wrapAnsi,
} from "@/tasks/dev/tui.ts";

const RED = "\x1b[31m";
const RESET = "\x1b[0m";

describe("visibleWidth", () => {
  test("counts printable characters", () => {
    expect(visibleWidth("hello")).toBe(5);
  });

  test("ignores SGR colour codes, which occupy no columns", () => {
    expect(visibleWidth(`${RED}hello${RESET}`)).toBe(5);
  });

  test("an empty string is zero wide", () => {
    expect(visibleWidth("")).toBe(0);
  });
});

describe("wrapAnsi", () => {
  test("a line shorter than the width is left alone", () => {
    expect(wrapAnsi("abc", 10)).toEqual(["abc"]);
  });

  test("a long line is hard-wrapped at the width", () => {
    expect(wrapAnsi("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  test("colour codes ride along without consuming width", () => {
    // Six visible characters at width 3 is exactly two rows, however many escape
    // bytes are interleaved — otherwise a coloured log line wraps early and the
    // right pane looks ragged next to an uncoloured one.
    const rows = wrapAnsi(`${RED}abcdef${RESET}`, 3);
    expect(rows).toHaveLength(2);
    expect(rows.map(visibleWidth)).toEqual([3, 3]);
  });

  test("an empty line still occupies one row, so blank log lines survive", () => {
    expect(wrapAnsi("", 10)).toEqual([""]);
  });

  test("a non-positive width degenerates to one row rather than looping forever", () => {
    expect(wrapAnsi("abc", 0)).toEqual(["abc"]);
  });
});

describe("clampOffset", () => {
  // offset counts lines scrolled back from the live tail; 0 follows.
  test("never scrolls past the newest line", () => {
    expect(clampOffset(-5, 100, 10)).toBe(0);
  });

  test("never scrolls past the oldest line", () => {
    // 100 lines in a 10-row pane: the furthest back is 90.
    expect(clampOffset(999, 100, 10)).toBe(90);
  });

  test("a backlog shorter than the pane cannot scroll at all", () => {
    expect(clampOffset(5, 3, 10)).toBe(0);
  });
});

describe("renderFrame", () => {
  const shortcuts = [
    { key: "n", label: "new plan" },
    { key: "r", label: "revise last" },
  ];
  const base = { shortcuts, title: "caret dev", status: ["port 1234"], offset: 0 };

  test("every row is exactly the terminal width, so no row wraps on its own", () => {
    const rows = renderFrame({ ...base, lines: ["one", "two"] }, 60, 8);
    expect(rows).toHaveLength(8);
    for (const row of rows) expect(visibleWidth(row)).toBe(60);
  });

  test("the rail takes a third of the width and the log takes the rest", () => {
    const rows = renderFrame({ ...base, lines: [] }, 60, 8);
    // The divider sits at the rail's width; left of it is rail, right is log.
    for (const row of rows) expect(row).toContain("│");
  });

  test("the shortcut keys and their labels are on the rail", () => {
    const flat = renderFrame({ ...base, lines: [] }, 80, 12).join("\n");
    expect(flat).toContain("n");
    expect(flat).toContain("new plan");
    expect(flat).toContain("revise last");
  });

  test("the status lines are on the rail", () => {
    const flat = renderFrame({ ...base, lines: [] }, 80, 12).join("\n");
    expect(flat).toContain("port 1234");
  });

  test("the newest log line is visible when following the tail", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line-${i}`);
    const flat = renderFrame({ ...base, lines }, 80, 10).join("\n");
    expect(flat).toContain("line-49");
    expect(flat).not.toContain("line-0");
  });

  test("scrolling back reveals older lines and hides the newest", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line-${i}`);
    const flat = renderFrame({ ...base, lines, offset: 20 }, 80, 10).join("\n");
    expect(flat).not.toContain("line-49");
    expect(flat).toContain("line-29");
  });

  test("a log line longer than the pane wraps instead of truncating", () => {
    const flat = renderFrame({ ...base, lines: ["x".repeat(200)] }, 60, 10).join("\n");
    // 200 chars cannot fit one ~39-column pane row, so it occupies several.
    expect(flat.split("\n").filter((r) => r.includes("x")).length).toBeGreaterThan(1);
  });

  test("a very narrow terminal still renders without throwing", () => {
    const rows = renderFrame({ ...base, lines: ["hello"] }, 12, 4);
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(visibleWidth(row)).toBe(12);
  });
});

describe("keyAction", () => {
  test("Ctrl-C quits — raw mode means nothing else will deliver SIGINT", () => {
    expect(keyAction("\x03")).toEqual({ kind: "quit" });
  });

  test("q quits too", () => {
    expect(keyAction("q")).toEqual({ kind: "quit" });
  });

  test("a bare n or r is an inject, with no Enter needed", () => {
    expect(keyAction("n")).toEqual({ kind: "inject", key: "n" });
    expect(keyAction("r")).toEqual({ kind: "inject", key: "r" });
  });

  test("the arrows scroll a line and the page keys scroll a page", () => {
    expect(keyAction("\x1b[A")).toEqual({ kind: "scroll", by: 1 });
    expect(keyAction("\x1b[B")).toEqual({ kind: "scroll", by: -1 });
    expect(keyAction("\x1b[5~")).toEqual({ kind: "page", by: 1 });
    expect(keyAction("\x1b[6~")).toEqual({ kind: "page", by: -1 });
  });

  test("G jumps back to the live tail", () => {
    expect(keyAction("G")).toEqual({ kind: "follow" });
  });

  test("an unknown key does nothing", () => {
    expect(keyAction("z")).toBeNull();
    expect(keyAction("")).toBeNull();
  });
});

describe("splitKeys", () => {
  test("a chunk of plain characters is one key each, so fast typing is not lost", () => {
    expect(splitKeys("nr")).toEqual(["n", "r"]);
  });

  test("an escape sequence stays whole rather than becoming four keys", () => {
    expect(splitKeys("\x1b[A")).toEqual(["\x1b[A"]);
  });

  test("an escape sequence followed by a character splits correctly", () => {
    expect(splitKeys("\x1b[An")).toEqual(["\x1b[A", "n"]);
  });

  test("an empty chunk yields nothing", () => {
    expect(splitKeys("")).toEqual([]);
  });
});

describe("createTui", () => {
  function fakeDeps(cols = 80, rows = 10) {
    let keyHandler: (c: string) => void = () => {};
    const frames: string[] = [];
    return {
      frames,
      press: (k: string) => keyHandler(k),
      deps: {
        write: (s: string) => frames.push(s),
        size: () => ({ cols, rows }),
        onKey: (h: (c: string) => void) => {
          keyHandler = h;
        },
        onResize: () => {},
        setRaw: () => {},
        // Repaint synchronously so assertions do not need to await a frame.
        schedule: (fn: () => void) => fn(),
      },
    };
  }

  const opts = (over: Record<string, unknown> = {}) => ({
    title: "caret dev",
    shortcuts: [{ key: "n", label: "new plan" }],
    onInject: () => {},
    onQuit: () => {},
    ...over,
  });

  test("written text reaches the log pane", () => {
    const { deps, frames } = fakeDeps();
    const tui = createTui(opts(), deps);
    tui.write("hello from the daemon\n");
    expect(frames.join("")).toContain("hello from the daemon");
    tui.stop();
  });

  test("a chunk split mid-line is joined, not shown as two lines", () => {
    // Piped child output arrives in arbitrary chunks, so a line can straddle two.
    const { deps, frames } = fakeDeps();
    const tui = createTui(opts(), deps);
    tui.write("part one ");
    tui.write("and two\n");
    expect(frames.join("")).toContain("part one and two");
    tui.stop();
  });

  test("pressing n injects without Enter", () => {
    const injected: string[] = [];
    const { deps, press } = fakeDeps();
    const tui = createTui(opts({ onInject: (k: string) => injected.push(k) }), deps);
    press("n");
    expect(injected).toEqual(["n"]);
    tui.stop();
  });

  test("Ctrl-C quits, since raw mode suppresses the signal", () => {
    let quit = 0;
    const { deps, press } = fakeDeps();
    const tui = createTui(opts({ onQuit: () => quit++ }), deps);
    press("\x03");
    expect(quit).toBe(1);
    tui.stop();
  });

  test("stop() restores the terminal it took over", () => {
    const { deps, frames } = fakeDeps();
    const tui = createTui(opts(), deps);
    tui.stop();
    const out = frames.join("");
    // Leaves the alternate screen and puts the cursor back.
    expect(out).toContain("\x1b[?1049l");
    expect(out).toContain("\x1b[?25h");
  });

  test("scrolling can reach the oldest line even when lines wrap", () => {
    // Scroll bounds have to count the rows the pane actually draws, not the
    // source lines: a backlog of wrapped lines occupies far more rows than it
    // has entries, so clamping against the entry count strands the oldest ones
    // off the top where no amount of scrolling reaches them.
    const { deps, frames, press } = fakeDeps(40, 6);
    const tui = createTui(opts(), deps);
    tui.write(`OLDEST ${"x".repeat(200)}\n`);
    for (let i = 0; i < 20; i++) tui.write(`filler ${i}\n`);
    frames.length = 0;
    for (let i = 0; i < 60; i++) press("\x1b[A");
    expect(frames.join("")).toContain("OLDEST");
    tui.stop();
  });

  test("a terminal reporting no size still paints a frame", () => {
    // A pty with no winsize set reports columns/rows as 0 (not undefined), so a
    // `?? default` misses it and the frame collapses to nothing — leaving the
    // alternate screen up with raw output bleeding across it.
    const { deps, frames } = fakeDeps(0, 0);
    const tui = createTui(opts(), deps);
    tui.write("still visible\n");
    expect(frames.join("")).toContain("still visible");
    tui.stop();
  });

  test("the backlog is bounded, so a long dev session cannot grow without limit", () => {
    const { deps } = fakeDeps();
    const tui = createTui(opts(), deps);
    for (let i = 0; i < MAX_LOG_LINES + 2000; i++) tui.write(`line ${i}\n`);
    expect(tui.lineCount()).toBeLessThanOrEqual(MAX_LOG_LINES);
    tui.stop();
  });
});
