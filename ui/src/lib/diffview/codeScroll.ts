// Block-level horizontal scroll sync for the plan source view's fenced-code panels
// (EXC-729). @pierre/diffs renders each source line as an independent [data-line] cell.
// The library's own horizontal scroll lives on the whole [data-code] grid, but EXC-692
// caps each fenced-code row at a reading width (max-width: 720px) NARROWER than that grid
// column, and coreStyles.ts makes each capped row its own horizontal scroll container so
// an over-wide line clips at the card's edge instead of breaking out. That per-row
// container is the only place the 720px cap can be honoured — but it also means a block's
// rows scroll independently, which would break the alignment of the tabular content plans
// routinely carry (the ASCII tables in the EXC-729 report). This module mirrors a scrolled
// code row's scrollLeft onto the other rows of the SAME block so the block scrolls as one
// unit. Pure DOM, unit-testable against a happy-dom fixture, mirroring codeBlocks.ts.
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
 * block so the whole block scrolls as one unit, and returns the rows whose scrollLeft
 * actually moved. A no-op (returns []) when `row` is not a code line. A row already at the
 * target, or one that clamps back to its prior value (a non-overflowing fence line pins at
 * 0), does not move and is not returned — so the caller can suppress exactly the echo
 * "scroll" events these writes fire, with no stale entries.
 */
export function syncCodeBlockScroll(row: Element): Element[] {
  if (!row.hasAttribute("data-code-line")) return [];
  const target = row.scrollLeft;
  const moved: Element[] = [];
  for (const other of blockRows(row)) {
    if (other === row) continue;
    const before = other.scrollLeft;
    if (before === target) continue;
    other.scrollLeft = target;
    // The browser clamps scrollLeft to the row's own max, so read back: a shorter
    // over-wide line lands short of `target`, and a non-overflowing line stays at 0.
    if (other.scrollLeft !== before) moved.push(other);
  }
  return moved;
}

/**
 * Attaches a capture-phase "scroll" listener to the view's shadow `root` so any scrolled
 * fenced-code row syncs its block. Scroll events don't bubble, hence capture. Each mirror
 * write fires an echo "scroll" on the row it moved; the listener can't tell that echo from
 * a real user scroll, and re-syncing from it would drag the block back to its shortest
 * over-wide line (a visible snap-back). So the rows a sync moved are tracked and their next
 * scroll event is consumed once. The root is stable across the library's repaints, so this
 * attaches once and needs no re-arming. Returns a teardown that removes the listener.
 */
export function attachCodeBlockScrollSync(root: ShadowRoot): () => void {
  const echoes = new Set<Element>();
  const onScroll = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element) || !target.hasAttribute("data-code-line")) return;
    // Our own mirror write echoed back — consume it once instead of re-syncing.
    if (echoes.delete(target)) return;
    for (const moved of syncCodeBlockScroll(target)) echoes.add(moved);
  };
  root.addEventListener("scroll", onScroll, true);
  return () => root.removeEventListener("scroll", onScroll, true);
}
