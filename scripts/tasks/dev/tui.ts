// The dev task's terminal UI: a shortcut rail down the left, the live log tail
// filling the rest. The rail is only as wide as its own longest line (capped at
// a third), so the log gets everything else.
//
// Why it repaints the whole screen rather than printing a banner and letting
// output scroll past: a terminal's scroll region (DECSTBM) reserves ROWS, never
// COLUMNS, so there is no way to pin a left-hand rail and still let normal
// output flow. Owning the screen is the price of the split — which means this
// module also owns the four writers that used to inherit the terminal (the
// daemon, pino-pretty, Vite, and this process's own stderr) and the scrollback
// the terminal would otherwise have given us for free, hence the scroll keys.
//
// It runs only when stdout is a TTY. Piped or redirected — CI, `> log.txt` — the
// dev task keeps its plain inherited-stdio behaviour and none of this loads.
//
// The pure half (visibleWidth / wrapAnsi / clampOffset / renderFrame / keyAction)
// is where the layout lives, so it is unit-tested without a terminal; `startTui`
// is the thin shell that pumps bytes through it.

/** SGR colour sequences. They occupy no columns, so width and wrapping have to
 * step over them — Vite and pino-pretty both colour their output. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ESC is the intent
const SGR = /\x1b\[[0-9;]*m/g;

/** Printable width of `s`, ignoring SGR escape sequences. */
export function visibleWidth(s: string): number {
  return s.replace(SGR, "").length;
}

/** Hard-wrap `s` to `width` visible columns, carrying SGR codes through so a
 * wrapped colour run keeps its colour on the next row. Returns at least one row,
 * so a blank log line still takes up a line. */
export function wrapAnsi(s: string, width: number): string[] {
  if (width <= 0 || visibleWidth(s) <= width) return [s];
  const rows: string[] = [];
  let row = "";
  let used = 0;
  // Walk the string in alternating escape / text runs so an escape never counts
  // toward the column budget and never gets split across rows.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ESC is the intent
  const parts = s.split(/(\x1b\[[0-9;]*m)/);
  for (const part of parts) {
    if (part === "") continue;
    if (part.startsWith("\x1b[")) {
      row += part;
      continue;
    }
    for (const ch of part) {
      if (used === width) {
        rows.push(row);
        row = "";
        used = 0;
      }
      row += ch;
      used++;
    }
  }
  if (row !== "" || rows.length === 0) rows.push(row);
  return rows;
}

/** Clamp a scroll offset (lines back from the live tail) to what the backlog can
 * actually show. 0 follows the newest line. */
export function clampOffset(offset: number, total: number, paneRows: number): number {
  const max = Math.max(0, total - paneRows);
  return Math.min(Math.max(0, offset), max);
}

export interface Shortcut {
  key: string;
  label: string;
}

export interface FrameState {
  shortcuts: readonly Shortcut[];
  /** Log backlog, oldest first. Each entry is one unwrapped source line. */
  lines: readonly string[];
  /** Lines scrolled back from the tail; 0 follows. */
  offset: number;
  title: string;
  /** Status items for the header row — the UI url to open, the daemon port. */
  status: readonly string[];
}

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/** Pad or truncate to exactly `width` visible columns, resetting SGR at the end
 * so a truncated colour run cannot bleed into the next pane or row. */
function fit(s: string, width: number): string {
  const w = visibleWidth(s);
  if (w === width) return `${s}${RESET}`;
  if (w < width) return `${s}${" ".repeat(width - w)}${RESET}`;
  return `${wrapAnsi(s, width)[0] ?? ""}${RESET}`;
}

/** The rail's width. Sized to its widest line rather than to a fraction of the
 * terminal: the shortcut labels are short and fixed, so a proportional rail just
 * grows whitespace on a wide window and steals it from the log. Capped at a
 * third so a long status line cannot crowd the pane out. */
export function railWidth(cols: number, lines: readonly string[] = []): number {
  const content = Math.max(0, ...lines.map(visibleWidth));
  return Math.max(10, Math.min(content + RAIL_PAD, Math.floor(cols / 3), cols - 4));
}

/** Breathing room to the right of the rail's longest line. */
const RAIL_PAD = 2;

/** The log pane's width — the rest of the row, less the divider column. */
export function paneWidth(cols: number, railLines: readonly string[] = []): number {
  return Math.max(1, cols - railWidth(cols, railLines) - 1);
}

/** Rows the split gets: the terminal less the header and the rule under it.
 * Scroll bounds and the renderer must agree on this, or scrolling stops short of
 * the oldest line by exactly the header's height. */
export function bodyRowsFor(rows: number): number {
  return Math.max(1, rows - 2);
}

/** How many rows `lines` occupies once wrapped to the pane. Scroll bounds count
 * these, not the entries: a backlog of long lines draws far more rows than it
 * has entries, and clamping against the entry count strands the oldest ones off
 * the top where scrolling cannot reach them. */
export function wrappedRowCount(lines: readonly string[], pane: number): number {
  let n = 0;
  for (const line of lines) n += wrapAnsi(line, pane).length;
  return n;
}

/** The full-width header: the title and the status items, one row above the
 * split. Status lives here rather than on the rail because the most useful item
 * is a URL to click, and a URL is wider than the whole shortcut list — putting it
 * on the rail would size the rail to the URL and steal that width from the log
 * on every row. */
export function headerLine(state: FrameState): string {
  const parts = [`${BOLD}${state.title}${RESET}`, ...state.status];
  return parts.join(`${DIM}  ·  ${RESET}`);
}

/** The rail's rendered lines: the shortcut list, nothing else. Shared with the
 * scroll clamp, which needs the pane width the next frame will use — and that
 * depends on the rail's content. */
export function railLines(state: FrameState): string[] {
  // Keys are padded to a common width so the labels form a column — they range
  // from "n" to "PgUp/Dn", which reads as ragged otherwise.
  const keyCol = Math.max(0, ...state.shortcuts.map((s) => s.key.length));
  return state.shortcuts.map((s) => ` ${BOLD}${s.key.padEnd(keyCol)}${RESET}  ${s.label}`);
}

/** Render one full frame as `rows` strings of exactly `cols` visible columns.
 * Pure: the caller decides when to paint it. */
export function renderFrame(state: FrameState, cols: number, rows: number): string[] {
  const left = railLines(state);
  const rail = railWidth(cols, left);
  const pane = paneWidth(cols, left);
  const bodyRows = bodyRowsFor(rows);

  const wrapped: string[] = [];
  for (const line of state.lines) wrapped.push(...wrapAnsi(line, pane));
  const offset = clampOffset(state.offset, wrapped.length, bodyRows);
  const end = wrapped.length - offset;
  const view = wrapped.slice(Math.max(0, end - bodyRows), end);
  // Bottom-align a short backlog so output grows downward like a normal terminal
  // rather than sitting at the top of the pane.
  const padded = [...Array<string>(Math.max(0, bodyRows - view.length)).fill(""), ...view];

  const out: string[] = [fit(headerLine(state), cols), `${DIM}${"─".repeat(cols)}${RESET}`];
  for (let i = 0; i < bodyRows; i++) {
    out.push(`${fit(left[i] ?? "", rail)}${DIM}│${RESET}${fit(padded[i] ?? "", pane)}`);
  }
  return out.slice(0, rows);
}

export type KeyAction =
  | { kind: "quit" }
  | { kind: "inject"; key: string }
  | { kind: "scroll"; by: number }
  | { kind: "page"; by: number }
  | { kind: "follow" };

/** Map one raw keypress to an action, or null to ignore it. Raw mode means no
 * Enter is needed — and that nothing else will turn Ctrl-C into a signal, so it
 * is mapped here explicitly. Positive `by` scrolls back into history. */
export function keyAction(key: string): KeyAction | null {
  switch (key) {
    case "\x03":
    case "q":
      return { kind: "quit" };
    case "n":
    case "r":
      return { kind: "inject", key };
    case "\x1b[A":
      return { kind: "scroll", by: 1 };
    case "\x1b[B":
      return { kind: "scroll", by: -1 };
    case "\x1b[5~":
      return { kind: "page", by: 1 };
    case "\x1b[6~":
      return { kind: "page", by: -1 };
    case "G":
      return { kind: "follow" };
    default:
      return null;
  }
}

/** Split one stdin chunk into individual keypresses. Plain characters are one
 * key each — two fast presses can share a chunk — while an escape sequence
 * (arrow, page) has to stay whole or it reads as four separate keys. */
export function splitKeys(chunk: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < chunk.length; ) {
    if (chunk[i] === "\x1b") {
      // Consume through the sequence's final byte (@ to ~ in the CSI range).
      let j = i + 1;
      if (chunk[j] === "[" || chunk[j] === "O") j++;
      while (j < chunk.length && !/[@-~]/.test(chunk[j] ?? "")) j++;
      keys.push(chunk.slice(i, j + 1));
      i = j + 1;
    } else {
      keys.push(chunk[i] as string);
      i++;
    }
  }
  return keys;
}

/** Scrollback cap. The terminal's own scrollback is gone once we take the
 * screen, so we keep our own — bounded, because `mise run dev` runs for hours. */
export const MAX_LOG_LINES = 5000;

const ALT_ON = "\x1b[?1049h";
const ALT_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const HOME = "\x1b[H";
const CLEAR_EOL = "\x1b[K";

/** The terminal effects the TUI performs, injected so the whole thing can be
 * driven with fakes in a test with no TTY attached. */
export interface TuiDeps {
  write: (s: string) => void;
  size: () => { cols: number; rows: number };
  onKey: (handler: (chunk: string) => void) => void;
  onResize: (handler: () => void) => void;
  setRaw: (on: boolean) => void;
  /** Coalesce repaints; production debounces a frame, tests run it inline. */
  schedule: (fn: () => void) => void;
}

export interface TuiOptions {
  title: string;
  shortcuts: readonly Shortcut[];
  /** A shortcut key was pressed (`n`, `r`). */
  onInject: (key: string) => void;
  /** Ctrl-C or `q`. The caller tears the dev stack down. */
  onQuit: () => void;
}

export interface Tui {
  /** Append child or in-process output. Chunks may split mid-line. */
  write: (chunk: string) => void;
  /** Replace the status lines pinned under the shortcut list. */
  setStatus: (lines: readonly string[]) => void;
  /** Current backlog size, for the bounded-growth test. */
  lineCount: () => number;
  /** Restore the terminal. Idempotent — teardown can arrive twice. */
  stop: () => void;
}

export function createTui(opts: TuiOptions, deps: TuiDeps): Tui {
  const lines: string[] = [];
  let partial = "";
  let status: readonly string[] = [];
  let offset = 0;
  let stopped = false;
  let painting = false;

  /** A pty with no winsize reports 0 rather than undefined, so `?? default`
   * misses it and the frame collapses to nothing — leaving the alternate screen
   * up with raw output bleeding across it. Falsy means "unknown", not "zero". */
  const size = () => {
    const { cols, rows } = deps.size();
    return { cols: Math.max(20, cols || 80), rows: Math.max(4, rows || 24) };
  };

  const frameState = (): FrameState => ({
    shortcuts: opts.shortcuts,
    title: opts.title,
    lines,
    offset,
    status,
  });

  /** The pane width the next frame will use. Scroll bounds have to agree with
   * what gets drawn, and the rail now sizes itself to its own content. */
  const currentPaneWidth = () => paneWidth(size().cols, railLines(frameState()));

  const paint = () => {
    if (stopped) return;
    const { cols, rows } = size();
    const frame = renderFrame(frameState(), cols, rows);
    deps.write(HOME + frame.map((r) => r + CLEAR_EOL).join("\r\n"));
  };

  const repaint = () => {
    if (stopped || painting) return;
    painting = true;
    deps.schedule(() => {
      painting = false;
      paint();
    });
  };

  deps.write(ALT_ON + CURSOR_HIDE);
  deps.setRaw(true);
  deps.onResize(() => paint());
  deps.onKey((chunk) => {
    for (const key of splitKeys(chunk)) {
      const action = keyAction(key);
      if (!action) continue;
      if (action.kind === "quit") {
        opts.onQuit();
        continue;
      }
      if (action.kind === "inject") {
        opts.onInject(action.key);
        continue;
      }
      const { rows } = size();
      if (action.kind === "follow") offset = 0;
      else offset += action.by * (action.kind === "page" ? rows : 1);
      offset = clampOffset(offset, wrappedRowCount(lines, currentPaneWidth()), bodyRowsFor(rows));
      paint();
    }
  });
  paint();

  return {
    write(chunk) {
      partial += chunk;
      const parts = partial.split("\n");
      // The trailing element is an unterminated line; hold it for the next chunk.
      partial = parts.pop() ?? "";
      for (const line of parts) lines.push(line.replace(/\r$/, ""));
      if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES);
      // Scrolled back? Hold position as new lines land, rather than yanking the
      // reader to the tail mid-read.
      if (offset > 0) {
        const { rows } = size();
        offset = clampOffset(
          offset + parts.length,
          wrappedRowCount(lines, currentPaneWidth()),
          bodyRowsFor(rows),
        );
      }
      repaint();
    },
    setStatus(next) {
      status = next;
      repaint();
    },
    lineCount: () => lines.length,
    stop() {
      if (stopped) return;
      stopped = true;
      deps.setRaw(false);
      deps.write(CURSOR_SHOW + ALT_OFF);
    },
  };
}
