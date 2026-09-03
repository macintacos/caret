// Which stacked modal owns a modal-local key (EXC-849). bits-ui portals each
// dialog to document.body in mount order, so the LAST OPEN `[data-slot='dialog-
// content']` in the DOM is the modal stacked highest. When ShortcutsHelp opens
// above Settings, both register a capture-phase `/` handler — this decides which
// one claims the key so `/` focuses the topmost modal's search, not whichever
// registered its listener first. ShortcutsHelp.focusDialog is the one caller;
// keep new topmost-dialog logic here rather than duplicating it there.

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

/** Claim `/` for a modal's own search input, capture-phase, for as long as the
 * returned teardown is uncalled. Capture so the preventDefault lands before the
 * bubble-phase global dispatcher (dispatcher.ts), which yields on
 * defaultPrevented — a modal traps focus on the dialog content rather than an
 * input, so isEditingContext() would not otherwise suppress the global `/`
 * (actions.search). Once the input owns focus, `/` types normally. The
 * topmost-dialog gate is what makes a stack route by portal order rather than by
 * registration order: Settings registers first, but `?` opens ShortcutsHelp above
 * it and the key belongs to whichever modal is on top. */
export function claimSlashForSearch(searchInput: () => HTMLInputElement | null): () => void {
  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== "/" || e.defaultPrevented) return;
    const input = searchInput();
    if (document.activeElement === input) return;
    if (!isTopmostDialog(input)) return;
    e.preventDefault();
    input?.focus();
  }
  window.addEventListener("keydown", onKeydown, { capture: true });
  return () => window.removeEventListener("keydown", onKeydown, { capture: true });
}
