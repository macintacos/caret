// Keyboard chord predicates shared by the comment/feedback editors. Pure TS so
// they stay node-free and unit-testable; each caller keeps its own
// preventDefault and side effects. The `aria-keyshortcuts="Meta+Enter
// Control+Enter"` annotations on those buttons mirror `isSubmitChord`.

/** Cmd+Enter (macOS) or Ctrl+Enter (elsewhere): the "submit this editor" chord. */
export function isSubmitChord(e: KeyboardEvent): boolean {
	return e.key === "Enter" && (e.metaKey || e.ctrlKey);
}

/** Escape: the "cancel/dismiss this editor" key. */
export function isCancelKey(e: KeyboardEvent): boolean {
	return e.key === "Escape";
}
