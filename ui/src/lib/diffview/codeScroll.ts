// Block-level horizontal scroll sync for the plan source view's fenced-code panels
// (EXC-729). @pierre/diffs renders each source line as an independent [data-line] cell,
// so a fenced code block has no single wrapper element to scroll — coreStyles.ts instead
// makes each code row its own horizontal scroll container. Left uncoordinated, scrolling
// one over-wide line would leave the block's other rows put, breaking the alignment of
// the tabular content plans routinely carry (the ASCII tables in the EXC-729 report).
// This module mirrors a scrolled code row's scrollLeft onto the other rows of the SAME
// block so the block scrolls as one unit. Pure DOM, unit-testable against a happy-dom
// fixture, mirroring codeBlocks.ts.
//
// The block boundaries are read from the tags codeBlocks.ts already applies
// (data-code-line / -start / -end), not from a ranges array, so the controller stays
// correct across the library's repaints without being re-armed with fresh ranges.

/**
 * The code rows of the block containing `row`, in document order. The block is the run of
 * [data-code-line] siblings bounded by the nearest preceding data-code-start and the
 * nearest following data-code-end, so two blocks abutting with no prose row between them
 * stay distinct even though their rows are contiguous. `row` must itself be a code row.
 */
function blockRows(row: Element): Element[] {
  const rows: Element[] = [row];
  // Extend back to the block's opening line (data-code-start).
  if (!row.hasAttribute("data-code-start")) {
    for (
      let p = row.previousElementSibling;
      p?.hasAttribute("data-code-line");
      p = p.previousElementSibling
    ) {
      rows.unshift(p);
      if (p.hasAttribute("data-code-start")) break;
    }
  }
  // Extend forward to the block's closing line (data-code-end).
  if (!row.hasAttribute("data-code-end")) {
    for (
      let n = row.nextElementSibling;
      n?.hasAttribute("data-code-line");
      n = n.nextElementSibling
    ) {
      rows.push(n);
      if (n.hasAttribute("data-code-end")) break;
    }
  }
  return rows;
}

/**
 * Mirrors the scrolled code `row`'s horizontal scrollLeft onto the other rows of its
 * block so the whole block scrolls as one unit. A no-op when `row` is not a code line.
 * Rows already at the target scrollLeft are skipped, so the scroll events those writes
 * fire find nothing to change and terminate — no feedback loop. Non-overflowing rows (a
 * short fence line) clamp the write to 0 in the browser, so they never shift.
 */
export function syncCodeBlockScroll(row: Element): void {
  if (!row.hasAttribute("data-code-line")) return;
  const target = row.scrollLeft;
  for (const other of blockRows(row)) {
    if (other !== row && other.scrollLeft !== target) other.scrollLeft = target;
  }
}

/**
 * Attaches a capture-phase "scroll" listener to the view's shadow `root` so any scrolled
 * fenced-code row syncs its block. Scroll events don't bubble, hence capture. The root is
 * stable across the library's repaints, so this attaches once and needs no re-arming.
 * Returns a teardown that removes the listener.
 */
export function attachCodeBlockScrollSync(root: ShadowRoot): () => void {
  const onScroll = (event: Event): void => {
    const target = event.target;
    if (target instanceof Element && target.hasAttribute("data-code-line")) {
      syncCodeBlockScroll(target);
    }
  };
  root.addEventListener("scroll", onScroll, true);
  return () => root.removeEventListener("scroll", onScroll, true);
}
