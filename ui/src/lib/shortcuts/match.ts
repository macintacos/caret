// The pure key matcher: does a keydown satisfy a chord, and does a run of
// keydowns complete a two-key sequence (`gg`, `]]`, `[[`)? No DOM ownership and
// no timers — the dispatcher drives this with the real event and clock, so the
// matching logic stays unit-testable in isolation. Generalizes the chord-
// predicate style of `keys.ts` (`isSubmitChord`/`isCancelKey`).

import type { Chord, ShortcutEntry } from "$lib/shortcuts/registry.ts";

/** Does a single keydown satisfy this chord? `mod` matches meta OR ctrl (the
 * platform-agnostic rule from `keys.ts`). A command modifier the chord did not
 * ask for disqualifies the match, so a bare key never fires under ⌘/Ctrl/Alt.
 * Shift is intentionally not checked: `KeyboardEvent.key` already encodes the
 * shifted character (`V`, `?`, `G`), so matching `key` covers it. */
export function chordMatches(chord: Chord, e: KeyboardEvent): boolean {
  if (e.key !== chord.key) return false;
  const mods = chord.mods ?? [];
  const wantMod = mods.includes("mod");
  const wantMeta = mods.includes("meta");
  const wantCtrl = mods.includes("ctrl");
  const wantAlt = mods.includes("alt");
  if (wantMod) {
    if (!e.metaKey && !e.ctrlKey) return false;
  } else {
    if (wantMeta !== e.metaKey) return false;
    if (wantCtrl !== e.ctrlKey) return false;
  }
  if (wantAlt !== e.altKey) return false;
  return true;
}

/** A pending two-key sequence: the entries whose first chord matched, and when
 * that first key landed (to enforce the timeout). */
export interface SequenceState {
  at: number;
  candidates: ShortcutEntry[];
}

export interface MatchResult {
  /** The entry to run, or null if the keydown matched nothing (yet). */
  entry: ShortcutEntry | null;
  /** The carry-forward sequence buffer, or null when there is nothing pending. */
  state: SequenceState | null;
}

/** Match one keydown against the entries, carrying a sequence buffer across
 * calls. Priority: complete a pending sequence (within `timeoutMs`), else match
 * a single-chord entry, else begin a new sequence buffer, else nothing. An
 * expired or non-completing buffer is discarded and the event is re-evaluated
 * fresh. Entries passed here are the dispatchable set — the dispatcher filters
 * display-only entries out before matching. */
export function matchKeydown(
  state: SequenceState | null,
  e: KeyboardEvent,
  entries: ShortcutEntry[],
  now: number,
  timeoutMs: number,
): MatchResult {
  if (state && now - state.at <= timeoutMs) {
    for (const entry of state.candidates) {
      const second = entry.keys[1];
      if (second && chordMatches(second, e)) {
        return { entry, state: null };
      }
    }
  }
  // Single-chord entries are matched before sequence buffering, so a single-key
  // shortcut preempts (shadows) any sequence sharing its first key. The canonical
  // keymap avoids this (gg/]]/[[ have no lone g/]/[ binding); a downstream author
  // registering a single-key next to a reserved sequence must mind the overlap.
  for (const entry of entries) {
    const only = entry.keys[0];
    if (entry.keys.length === 1 && only && chordMatches(only, e)) {
      return { entry, state: null };
    }
  }
  const candidates = entries.filter((entry) => {
    const first = entry.keys[0];
    return entry.keys.length === 2 && first !== undefined && chordMatches(first, e);
  });
  if (candidates.length > 0) {
    return { entry: null, state: { at: now, candidates } };
  }
  return { entry: null, state: null };
}
