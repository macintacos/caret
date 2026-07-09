// Block-level horizontal scroll sync for the plan source view's fenced-code panels
// (EXC-729). @pierre/diffs renders each source line as an independent [data-line] cell.
// The library's own horizontal scroll lives on the whole [data-code] grid, but EXC-692
// caps each fenced-code row at a reading width (max-width: 720px) NARROWER than that grid
// column, so an over-wide line has to scroll within its own row. Per-row scrollbars look
// terrible (one bar per line on classic-scrollbar platforms), so codeScrollbar.ts hides
// them and injects a SINGLE scrollbar element per block; this module keeps that bar and the
// block's rows in lockstep so the block scrolls as one unit — dragging the bar scrolls every
// row, and a trackpad scroll over any row moves the others and the bar. Pure DOM,
// unit-testable against a happy-dom fixture, mirroring codeBlocks.ts.
//
// The block boundaries are read from the tags codeBlocks.ts already applies
// (data-code-line / -start / -end), not from a ranges array, so the sync stays correct
// across the library's repaints without being re-armed with fresh ranges.

import { SCROLLBAR_ATTR } from "./codeScrollbar.ts";

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
 * Every scroll participant of the block that `el` belongs to: the block's code rows plus
 * its injected scrollbar (codeScrollbar.ts), if present. `el` may be a code row or the
 * scrollbar. The bar is keyed to the block by its start line, so it is found from any row
 * (via the block's opening line) and, when `el` is the bar itself, its own key resolves the
 * opening row. Returns an empty list for anything that is neither.
 */
function blockParticipants(el: Element): Element[] {
  const content = el.parentElement;
  if (content == null) return [];
  let rows: Element[];
  if (el.hasAttribute("data-code-line")) {
    rows = blockRows(el);
  } else if (el.hasAttribute(SCROLLBAR_ATTR)) {
    const startLine = el.getAttribute(SCROLLBAR_ATTR) ?? "";
    const startRow = content.querySelector(`:scope > [data-line="${startLine}"]`);
    rows = startRow == null ? [] : blockRows(startRow);
  } else {
    return [];
  }
  if (rows.length === 0) return [];
  const startLine = rows[0]?.getAttribute("data-line") ?? "";
  const bar = content.querySelector(`:scope > [${SCROLLBAR_ATTR}="${startLine}"]`);
  return bar == null ? rows : [...rows, bar];
}

/**
 * Mirrors the scrolled `el`'s horizontal scrollLeft onto the other participants of its
 * block (the sibling rows and the block's scrollbar) so the whole block scrolls as one
 * unit, and returns the participants whose scrollLeft actually moved. A no-op (returns [])
 * when `el` is neither a code row nor a block scrollbar. Participants already at the target,
 * or ones that clamp back to their prior value (a short row pins at 0), do not move and are
 * not returned — so the caller can suppress exactly the echo "scroll" events these writes
 * fire, with no stale entries.
 */
export function syncCodeBlockScroll(el: Element): Element[] {
  const participants = blockParticipants(el);
  if (participants.length === 0) return [];
  const target = el.scrollLeft;
  const moved: Element[] = [];
  for (const other of participants) {
    if (other === el) continue;
    const before = other.scrollLeft;
    if (before === target) continue;
    other.scrollLeft = target;
    // The browser clamps scrollLeft to each element's own max, so read back: a shorter
    // over-wide row lands short of `target`, and a non-overflowing row stays at 0.
    if (other.scrollLeft !== before) moved.push(other);
  }
  return moved;
}

/**
 * Attaches a capture-phase "scroll" listener to the view's shadow `root` so any scrolled
 * fenced-code row or block scrollbar syncs its block. Scroll events don't bubble, hence
 * capture. Each mirror write fires an echo "scroll" on the element it moved; the listener
 * can't tell that echo from a real scroll, and re-syncing from it would drag the block back
 * to its shortest over-wide row (a visible snap-back). So the elements a sync moved are
 * tracked and their next scroll event is consumed once. The root is stable across the
 * library's repaints, so this attaches once and needs no re-arming. Returns a teardown.
 */
export function attachCodeBlockScrollSync(root: ShadowRoot): () => void {
  const echoes = new Set<Element>();
  const onScroll = (event: Event): void => {
    const target = event.target;
    if (
      !(target instanceof Element) ||
      !(target.hasAttribute("data-code-line") || target.hasAttribute(SCROLLBAR_ATTR))
    ) {
      return;
    }
    // Our own mirror write echoed back — consume it once instead of re-syncing.
    if (echoes.delete(target)) return;
    for (const moved of syncCodeBlockScroll(target)) echoes.add(moved);
  };
  root.addEventListener("scroll", onScroll, true);
  return () => root.removeEventListener("scroll", onScroll, true);
}
