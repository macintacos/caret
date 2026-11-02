// When the outline's peek opens, which row it shows, and where it stands beside the
// outline. Pure: the outline reports what the pointer and the keys do, and the peek
// renders what this decides.

/** How long the pointer or the keys rest on a row before the peek opens. */
export const PEEK_INTENT_MS = 350;

/** The row a peek stands beside. */
export interface PeekTarget {
  /** The row's heading line. */
  line: number;
  row: HTMLElement;
  /** The outline the row sits in, whose right edge the peek stands past. */
  outline: HTMLElement;
}

export interface PeekIntentDeps {
  /** The row the peek now shows, by its heading's line, or null once it hides. */
  onChange(line: number | null): void;
  /** setTimeout-shaped, returning a cancel fn. Defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

export interface PeekIntent {
  /** The pointer or the keys reached a row. */
  reach(line: number): void;
  hide(): void;
}

const defaultSchedule = (fn: () => void, ms: number) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

export function createPeekIntent(deps: PeekIntentDeps): PeekIntent {
  const schedule = deps.schedule ?? defaultSchedule;
  let shown: number | null = null;
  let dwell: { line: number; cancel(): void } | null = null;

  function cancelDwell(): void {
    dwell?.cancel();
    dwell = null;
  }

  function show(line: number): void {
    if (line === shown) return;
    shown = line;
    deps.onChange(line);
  }

  function reach(line: number): void {
    if (shown !== null) {
      show(line);
      return;
    }
    if (dwell?.line === line) return;
    cancelDwell();
    const cancel = schedule(() => {
      dwell = null;
      show(line);
    }, PEEK_INTENT_MS);
    dwell = { line, cancel };
  }

  function hide(): void {
    cancelDwell();
    if (shown === null) return;
    shown = null;
    deps.onChange(null);
  }

  return { reach, hide };
}

export interface PeekSize {
  /** Between the outline's edge and the peek. */
  gap: number;
  /** Kept clear inside the bounds. */
  margin: number;
  minWidth: number;
  maxWidth: number;
}

/** The peek's width beside an outline whose right edge is at `edge`, or null where the
 * room up to `boundsRight` is narrower than its least width. Pixels throughout. */
export function peekWidth(edge: number, boundsRight: number, size: PeekSize): number | null {
  const room = boundsRight - size.margin - (edge + size.gap);
  return room < size.minWidth ? null : Math.min(size.maxWidth, room);
}

/** The peek's top: level with its row's, raised as far as its foot needs to stay inside
 * the bounds, and never above them. */
export function peekTop(
  rowTop: number,
  height: number,
  bounds: { top: number; bottom: number },
  margin: number,
): number {
  return Math.max(bounds.top + margin, Math.min(rowTop, bounds.bottom - margin - height));
}
