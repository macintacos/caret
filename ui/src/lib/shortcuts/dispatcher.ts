// The global keydown dispatcher: one listener that matches events to registered
// shortcuts and invokes their run(). Focus-aware — single-key shortcuts yield
// while a text field or the CodeMirror composer is focused, and any event a
// focused widget already handled (defaultPrevented) is left alone. A framework-
// agnostic factory over injected deps (target, registry, clock), wired in
// App.svelte's $effect exactly like createSafeModeGuard.

import { matchKeydown, type SequenceState } from "$lib/shortcuts/match.ts";
import type { KeySpec, ShortcutRegistry } from "$lib/shortcuts/registry.ts";

const DEFAULT_SEQUENCE_TIMEOUT_MS = 1000;

export interface ShortcutDispatcherOptions {
  /** Event source — `window` in the app. */
  target: EventTarget;
  /** The registry whose entries are matched against keydowns. */
  registry: ShortcutRegistry;
  /** Whether a text-editing widget owns the keyboard right now; single-key
   * shortcuts are suppressed when true. Defaults to a DOM activeElement check. */
  isEditingContext?: () => boolean;
  /** Monotonic clock; injectable for tests. Defaults to performance.now. */
  now?: () => number;
  /** Max gap between the two keys of a sequence (gg, ]]). */
  sequenceTimeoutMs?: number;
}

export interface ShortcutDispatcher {
  /** Detach the listener. */
  destroy: () => void;
}

/** Default editing-context check: the focused element is a text input, textarea,
 * select, a contenteditable, or inside CodeMirror's editable content. */
export function defaultIsEditingContext(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return el.closest(".cm-editor") !== null;
}

/** A spec is "bare" — subject to editing-context suppression — when none of its
 * chords require a command modifier. Shift is not a command modifier: it is
 * already encoded in the chord's key (`V`, `?`, `G`). */
function isBareSpec(spec: KeySpec): boolean {
  return spec.every(
    (c) => !(c.mods ?? []).some((m) => m === "mod" || m === "ctrl" || m === "meta" || m === "alt"),
  );
}

export function createShortcutDispatcher(opts: ShortcutDispatcherOptions): ShortcutDispatcher {
  const { target, registry } = opts;
  const isEditingContext = opts.isEditingContext ?? defaultIsEditingContext;
  const now = opts.now ?? (() => performance.now());
  const timeoutMs = opts.sequenceTimeoutMs ?? DEFAULT_SEQUENCE_TIMEOUT_MS;

  let seq: SequenceState | null = null;

  function onKeyDown(ev: Event): void {
    const e = ev as KeyboardEvent;
    // Yield to a focused widget that already handled the key (e.g. the ToC
    // filter's Arrow/Enter) and to Safe Mode's capture-phase swallow.
    if (e.defaultPrevented) return;
    // Only dispatchable entries fire; display-only entries (the editor chords)
    // live in the registry for the help modal, never for dispatch.
    let entries = registry.list().filter((entry) => entry.run);
    // Single-key (bare) shortcuts do not fire while a text field or the composer
    // is focused — that surface keeps owning its own keys.
    if (isEditingContext()) {
      entries = entries.filter((entry) => !isBareSpec(entry.keys));
      // Drop a pending bare sequence so its second key can't complete inside the
      // focused field (matchKeydown completes from the buffer, bypassing the
      // filter above).
      if (seq?.candidates.every((c) => isBareSpec(c.keys))) seq = null;
    }
    const { entry, state } = matchKeydown(seq, e, entries, now(), timeoutMs);
    seq = state;
    if (entry && entry.enabled?.() !== false) {
      e.preventDefault();
      entry.run?.();
    }
  }

  // Bubble phase: Safe Mode's capture-phase guard (safeMode.ts) runs first and
  // can stopImmediatePropagation to preempt us during its grace window.
  target.addEventListener("keydown", onKeyDown);

  return {
    destroy() {
      target.removeEventListener("keydown", onKeyDown);
    },
  };
}
