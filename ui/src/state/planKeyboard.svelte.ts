// The plan source view's keyboard surface: the vim line cursor, visual line-select,
// and the `/` full-text search HUD, as one deep, unit-testable factory the DiffPlanView
// shell drives (EXC-875). Like the other state modules (compare, autosave), this is a
// plain factory over an injected backing store plus a deps bag — the
// component owns the reactive `$state` store, tests pass a plain object, and every DOM
// effect (scroll-follow, the shared jump, focus/blur, the composer open) is injected so
// the transitions stay testable without mounting the view.
//
// The three surfaces are one machine: they share the reading-position seed
// (`cursorLine ?? readingLine()`), the Esc-priority chain (Esc closes search, THEN exits
// visual — never clears the cursor), and the content-switch reset. The pure sinks
// (resolveCursorLine, findMatches, nearestMatchIndex, matchStepFromLine, stepIndex) do
// the arithmetic; this factory only sequences them and mutates the store.

import { normalizeRange } from "$lib/diffview/commenting.ts";
import { type CursorMotion, resolveCursorLine } from "$lib/diffview/lineCursor.ts";
import {
  findMatches,
  matchStepFromLine,
  nearestMatchIndex,
  type SearchMatch,
  stepIndex,
} from "$lib/diffview/planSearch.ts";

/** Reactive fields the host component owns and the factory mutates. App/DiffPlanView
 * supplies a `$state`-backed literal; tests pass a plain object. */
export interface PlanKeyboardStore {
  /** The focused line the vim motions move and a line click relocates (EXC-788);
   * null when the cursor is unplaced. */
  cursorLine: number | null;
  /** The fixed end of a `V` selection (EXC-790); null when not in visual mode. */
  visualAnchor: number | null;
  /** The search pill is mounted (open for typing, or a committed HUD). */
  searchOpen: boolean;
  /** Enter committed the query: the field is blurred, n/N step, `/` reopens it. */
  searchCommitted: boolean;
  /** The live query bound to the search field. */
  searchQuery: string;
  /** The current match index, or -1 when there is none. */
  searchIndex: number;
  /** The last COMMITTED query, remembered for the session so `/` reopens with it
   * prefilled and n/N can resume it while the pill is closed. Held separately from
   * searchQuery so a close or a content switch never clears it. */
  lastQuery: string;
  /** The pill is playing its collapse-back-to-the-chip animation before teardown. */
  searchClosing: boolean;
}

/** The effects the factory performs, injected so it stays DOM-free and testable. */
export interface PlanKeyboardDeps {
  /** The rendered plan text as lines (the view's `linkLayer.text` split on "\n"). */
  lines(): string[];
  /** Heading source lines in ascending order (the `{`/`}`-adjacent motion targets). */
  headingLines(): number[];
  /** The reading-position seed — the top-visible line, or null before the view paints. */
  readingLine(): number | null;
  /** Lines a half-page motion (Ctrl+d / Ctrl+u) covers — measured from the scroller. */
  halfPage(): number;
  /** Scroll the view to keep `line` visible — the keyboard cursor's follow scroll. */
  follow(line: number): void;
  /** Scroll `line` to the top of the view — the shared jump every navigation to an
   * explicit place takes (a heading pick, a deep link), the counterpart to `follow`'s
   * scrolloff-only nudge. */
  jump(line: number): void;
  /** Open the comment composer over an inclusive line range (retaining any live text and
   * relocating the cursor, as a gutter/line click does). */
  openComposer(startLine: number, endLine: number): void;
  /** Focus + select the search input. */
  focusField(): void;
  /** Blur the active element, returning focus to the plan. */
  blur(): void;
  /** Whether the collapse chip is shown (Show Hints): true animates the close, false
   * tears the pill down at once (there is no chip to collapse into). */
  hintsShown(): boolean;
  /** Schedule the deferred close teardown; defaults to setTimeout. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Cancel a scheduled teardown; defaults to clearTimeout. */
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface PlanKeyboard {
  /** The matches for the current query over the rendered text — consumed by the host's
   * `searchMatches` derived (pill counter, highlight) and internally by the transitions.
   * An empty query yields no matches. */
  matches(): SearchMatch[];
  /** A vim motion (j/k, Ctrl+d/u, gg/G, heading and blank-line jumps): resolve the target
   * line, place the cursor there, and scroll to it — the heading motions take the shared
   * top-parked jump, every other motion the scrolloff follow. An unplaced cursor reveals
   * at the reading position rather than stepping past it. */
  moveCursor(motion: CursorMotion): void;
  /** `c`: open the composer over the cursor line, or — in visual mode — over the whole
   * anchored selection, exiting visual mode as it opens. Seeds an unplaced cursor at the
   * reading position. */
  commentCursorLine(): void;
  /** `V`: toggle visual line-select. On entry, anchor at the cursor (seeded at the reading
   * position when unplaced) so j/k extend the span; pressing V again exits, keeping the
   * cursor placed. */
  enterVisualMode(): void;
  /** Esc: close the search HUD if open, else exit visual mode if active — in that priority
   * order. Never clears the line cursor (the reader keeps their place). */
  clearSelectionOrCursor(): void;
  /** `/`: open the pill prefilled with the last committed query and focus the field. */
  openSearch(): void;
  /** Esc / ✕: blur and dismiss the pill — immediately with hints off, or after the
   * collapse animation with hints on. Clearing the query clears the highlights. */
  closeSearch(): void;
  /** Enter: remember the query, land the cursor on the nearest match, keep the pill as a
   * HUD, and blur so bare n/N/Esc fire globally. No matches → nothing to commit. */
  commitSearch(): void;
  /** n (+1) / N (-1): step the current match with wrap while a search is up, or RESUME a
   * remembered query from the reading position when the pill is closed. */
  stepSearch(delta: number): void;
  /** Re-track the index to the nearest match at the reading position — the host calls
   * this (gated + untracked) when the query changes while the field is being edited. */
  retrackToNearest(): void;
  /** Cancel a pending close animation (reopening mid-collapse). */
  cancelClose(): void;
  /** A content switch (new version / review switch): drop cursor, visual, and the live
   * search, keeping the remembered query so a later `/` still resumes it. */
  clearForContentSwitch(): void;
}

// Must match PlanSearch's search-collapse duration (--dur-fast = 120ms). happy-dom
// fires no animationend, so a timer — not that event — drives the teardown.
const CLOSE_ANIM_MS = 120;

/** The motions that navigate to a named SECTION — the same move a breadcrumb or ToC
 * pick makes — so they take the top-parked shared jump. Every other motion keeps the
 * scrolloff follow, and that exclusion is the load-bearing half: gg/G/{/} step the
 * reader THROUGH the document rather than to a section, and `G` is only right when the
 * last line lands at the bottom. Widening this set on the "navigates somewhere
 * explicit" reading alone would break it. */
const JUMP_MOTIONS: ReadonlySet<CursorMotion> = new Set(["nextHeading", "prevHeading"]);

export function createPlanKeyboard(store: PlanKeyboardStore, deps: PlanKeyboardDeps): PlanKeyboard {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h));
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  // Matches over the SAME rendered text the cursor uses, so a match's line maps straight
  // onto the line cursor and its shadow-row highlight.
  function matches(): SearchMatch[] {
    return store.searchQuery === "" ? [] : findMatches(deps.lines(), store.searchQuery);
  }

  // The reader's current line: the placed cursor, else the reading position, else line 1.
  // The shared seed every search/motion transition starts from.
  function seedLine(): number {
    return store.cursorLine ?? deps.readingLine() ?? 1;
  }

  // Lines the cursor may occupy: the rendered plan rows, trailing newline trimmed so `G`
  // lands on a real row. deps.lines() is the text split on "\n", so a trailing newline
  // leaves a final "" entry that is not a row.
  function lineCount(): number {
    const lines = deps.lines();
    const n = lines.length;
    return Math.max(1, lines[n - 1] === "" ? n - 1 : n);
  }

  // The blank (empty or whitespace-only) source lines the `{` / `}` motions jump between —
  // the plan's paragraph boundaries, capped to real rows so a trailing newline is not a
  // target.
  function blankLines(): number[] {
    const count = lineCount();
    return deps
      .lines()
      .slice(0, count)
      .flatMap((line, i) => (line.trim() === "" ? [i + 1] : []));
  }

  // Land the cursor on `line` and scroll to it. `scroll` picks WHICH scroll: the
  // scrolloff follow by default (a match reveal, the visual-mode anchor, every
  // stepping motion), or the shared top-parked jump for a heading motion. Single
  // source for the landing itself, so a rule added here reaches all of them.
  function reveal(line: number, scroll: (line: number) => void = deps.follow): void {
    store.cursorLine = line;
    scroll(line);
  }

  function cancelClose(): void {
    if (closeTimer !== undefined) {
      clearTimer(closeTimer);
      closeTimer = undefined;
    }
    store.searchClosing = false;
  }

  // Reset the search state without touching focus — used on close and content switch.
  // Also cancels an in-flight close so a version change during the collapse tears down
  // cleanly rather than leaving a stale timer to fire against the new content. Never
  // touches lastQuery, so the remembered query survives.
  function resetSearch(): void {
    cancelClose();
    store.searchOpen = false;
    store.searchCommitted = false;
    store.searchQuery = "";
    store.searchIndex = -1;
  }

  // Move the line cursor to the match at searchIndex and scroll it into view.
  function revealMatch(): void {
    const m = matches()[store.searchIndex];
    if (m == null) return;
    reveal(m.line);
  }

  // Dismiss the pill. Blur now so focus returns to the plan and the cursor/highlights stay
  // where they landed. With hints on there's a "/ to search" chip to collapse back into,
  // so keep the pill mounted for one --dur-fast playing its collapse animation, then reset;
  // with hints off there's no chip, so reset immediately. Shared by the Esc chain.
  function closeSearch(): void {
    deps.blur();
    if (!deps.hintsShown()) {
      resetSearch();
      return;
    }
    if (closeTimer !== undefined) clearTimer(closeTimer);
    store.searchClosing = true;
    closeTimer = setTimer(resetSearch, CLOSE_ANIM_MS);
  }

  return {
    matches,

    moveCursor(motion) {
      const line = resolveCursorLine(motion, {
        cursor: store.cursorLine,
        lineCount: lineCount(),
        headingLines: deps.headingLines(),
        blankLines: blankLines(),
        halfPage: deps.halfPage(),
        seed: deps.readingLine() ?? 1,
      });
      reveal(line, JUMP_MOTIONS.has(motion) ? deps.jump : deps.follow);
    },

    commentCursorLine() {
      // Visual mode: comment the whole anchored selection (normalized ascending) and exit
      // visual mode as it opens.
      if (store.visualAnchor != null) {
        const { startLine, endLine } = normalizeRange({
          start: store.visualAnchor,
          end: store.cursorLine ?? store.visualAnchor,
        });
        store.visualAnchor = null;
        deps.openComposer(startLine, endLine);
        return;
      }
      const line = seedLine();
      deps.openComposer(line, line);
    },

    enterVisualMode() {
      // Pressing V again exits, as vim's V does, keeping the cursor placed.
      if (store.visualAnchor != null) {
        store.visualAnchor = null;
        return;
      }
      const anchor = seedLine();
      reveal(anchor);
      store.visualAnchor = anchor;
    },

    clearSelectionOrCursor() {
      // Esc priority: close the search HUD first, then exit visual mode. Esc never clears
      // the line cursor (EXC-834) — the reader keeps their place; a content switch clears
      // it via clearForContentSwitch, not Esc.
      if (store.searchOpen) {
        closeSearch();
        return;
      }
      if (store.visualAnchor != null) store.visualAnchor = null;
    },

    openSearch() {
      cancelClose();
      store.searchOpen = true;
      store.searchCommitted = false;
      store.searchQuery = store.lastQuery;
      store.searchIndex = -1;
      deps.focusField();
    },

    closeSearch,

    commitSearch() {
      const ms = matches();
      if (ms.length === 0) return;
      store.lastQuery = store.searchQuery;
      store.searchIndex = nearestMatchIndex(ms, seedLine());
      revealMatch();
      store.searchCommitted = true;
      deps.blur();
    },

    stepSearch(delta) {
      // Pill closed with a remembered query → RESUME: restore the query, show the pill as
      // a committed HUD, and seed the match from the reading position (next/previous
      // relative to where you are).
      if (!store.searchOpen) {
        if (store.lastQuery === "") return;
        store.searchQuery = store.lastQuery;
        store.searchOpen = true;
        store.searchCommitted = true;
        store.searchIndex = matchStepFromLine(matches(), seedLine(), delta);
        revealMatch();
        return;
      }
      const ms = matches();
      if (ms.length === 0) return;
      store.searchIndex = stepIndex(ms.length, store.searchIndex, delta);
      revealMatch();
    },

    retrackToNearest() {
      store.searchIndex = nearestMatchIndex(matches(), seedLine());
    },

    cancelClose,

    clearForContentSwitch() {
      store.cursorLine = null;
      store.visualAnchor = null;
      resetSearch();
    },
  };
}
