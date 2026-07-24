// The plan source view's keyboard surface: the vim line cursor, visual line-select,
// and the `/` full-text search HUD, lifted out of DiffPlanView.svelte into one deep,
// unit-testable factory (EXC-875). Like the other state modules (compare, autosave),
// this is a plain factory over an injected backing store plus a deps bag — the
// component owns the reactive `$state` store, tests pass a plain object, and every DOM
// effect (scroll-follow, focus/blur, the composer open) is injected so the transitions
// stay testable without mounting the view.
//
// The three surfaces are one machine: they share the reading-position seed
// (`cursorLine ?? readingLine()`), the Esc-priority chain (Esc closes search, THEN exits
// visual — never clears the cursor), and the content-switch reset. The pure sinks
// (resolveCursorLine, findMatches, nearestMatchIndex, matchStepFromLine, stepIndex) do
// the arithmetic; this factory only sequences them and mutates the store.

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
  /** The reading-position seed — the top-visible line, or null before the view paints. */
  readingLine(): number | null;
  /** Scroll the view to keep `line` visible — the keyboard cursor's follow scroll. */
  follow(line: number): void;
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

  // Land the cursor on `line` and scroll it into view — a match reveal or a motion.
  function reveal(line: number): void {
    store.cursorLine = line;
    deps.follow(line);
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

  return {
    matches,

    openSearch() {
      cancelClose();
      store.searchOpen = true;
      store.searchCommitted = false;
      store.searchQuery = store.lastQuery;
      store.searchIndex = -1;
      deps.focusField();
    },

    closeSearch() {
      deps.blur();
      // With hints off there's no chip to collapse into, so close immediately.
      if (!deps.hintsShown()) {
        resetSearch();
        return;
      }
      if (closeTimer !== undefined) clearTimer(closeTimer);
      store.searchClosing = true;
      closeTimer = setTimer(resetSearch, CLOSE_ANIM_MS);
    },

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
