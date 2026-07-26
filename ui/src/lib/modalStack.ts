// Which stacked modal owns a modal-local key (EXC-849). bits-ui portals each
// dialog to document.body in mount order, so the LAST `[data-slot='dialog-
// content']` in the DOM is the modal stacked highest. When ShortcutsHelp opens
// above Settings, both register a capture-phase `/` handler — this decides which
// one claims the key so `/` focuses the topmost modal's search, not whichever
// registered its listener first. Pure and node-free: the modals drive it, so the
// "take the last portalled dialog" rule is unit-testable without mounting (see
// modalStack.test.ts; svelte-rules.md "extract component logic to a testable lib
// module"). The idiom was inlined in ShortcutsHelp.focusDialog; this is its one
// source.

/** The topmost open dialog's content — the last `[data-slot='dialog-content']`
 * in document order, i.e. the modal stacked above any others. Null when none is
 * open. Narrowed to `data-state='open'` because a modal now outlives its flag
 * while it plays its exit (EXC-891): during the guard's divert to Request
 * Changes two contents coexist, and the one on its way out is the later node —
 * it must not claim the key from the surface that stays. */
export function topmostDialogContent(root: ParentNode = document): HTMLElement | null {
  const all = root.querySelectorAll<HTMLElement>("[data-slot='dialog-content'][data-state='open']");
  return all[all.length - 1] ?? null;
}

/** Whether `el` lives inside the topmost open dialog — a modal-local `/` handler
 * gates on this so only the stacked-highest modal claims the key. */
export function isTopmostDialog(el: Element | null, root: ParentNode = document): boolean {
  const content = el?.closest<HTMLElement>("[data-slot='dialog-content']") ?? null;
  return content != null && content === topmostDialogContent(root);
}
