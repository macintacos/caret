// Host-side comment-span brackets for the source view.
//
// @pierre/diffs draws a rounded vertical decoration bar to mark a comment's
// covered line span, but its `[data-decoration-bar-*]` CSS is dormant: no
// runtime in the library emits those attributes (they belong to its app-layer
// CodeView, not the FileDiff caret consumes), and the public LineAnnotation type
// carries no range. So the bracket is produced host-side: a caret-owned overlay
// of absolutely-positioned rails, aligned to the shadow-DOM `[data-line]` rows
// the view paints, reproducing the library's bar SHAPE (a ~6px rail with rounded
// start/end caps). A comment anchors its card to `endLine`; the bracket is the
// only cue that `startLine`..`endLine-1` belong to the same comment.
//
// The overlay can't live inside the view's host: an element with a shadow root
// renders only the light children its shadow `<slot>`s project, and the library
// has no slot for a bracket, so an unslotted child would have no box. It lives
// instead in the scroll container (`.diff-plan`), a caret-owned element, as an
// absolutely-positioned layer over the scroll CONTENT — so it scrolls with the
// rows for free. The `--diffs-decoration-bar-color` var lives on the `.diffview`
// rule (the single --diffs-* bridge); since the layer is a sibling of the host,
// not a descendant, the action copies the resolved value onto the layer so the
// rails inherit it.
//
// This module is the geometry + the imperative overlay lifecycle. The math
// (`bracketBox`) is pure so it unit-tests without layout; the action
// (`bracketLayer`) owns the measuring, the resize re-measure, and the teardown —
// happy-dom can't lay out, so the action's pixels are exercised by e2e.

/** The CSS var carrying the rail color, declared once on the `.diffview` rule. */
const BAR_COLOR_VAR = "--diffs-decoration-bar-color";

/** A comment's covered line range, 1-based and inclusive. */
export interface BracketSpan {
  startLine: number;
  endLine: number;
}

/** Top offset (px, relative to the scroll content origin) and height of a rail. */
export interface BracketBox {
  top: number;
  height: number;
}

/** Reads an element's top/bottom in viewport coordinates. Injectable so the
 * geometry is testable without real layout (happy-dom returns all zeros). */
export type RectReader = (el: HTMLElement) => { top: number; bottom: number };

const defaultReader: RectReader = (el) => {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom };
};

/**
 * The rail box for a span over the host's `[data-line]` rows, expressed in the
 * scroll container's content coordinates so an absolutely-positioned rail inside
 * `scroller` sits on the rows and scrolls with them. Returns null when no row in
 * the range is rendered. The box spans the top of the first present row to the
 * bottom of the last; when an endpoint is off the rendered window it clamps to
 * the rows that are present, so a partially-scrolled span still draws.
 */
export function bracketBox(
  host: HTMLElement,
  scroller: HTMLElement,
  span: BracketSpan,
  read: RectReader = defaultReader,
): BracketBox | null {
  const lo = Math.min(span.startLine, span.endLine);
  const hi = Math.max(span.startLine, span.endLine);
  const root = host.shadowRoot;
  if (root == null) return null;
  let top: number | undefined;
  let bottom: number | undefined;
  for (let line = lo; line <= hi; line++) {
    const row = root.querySelector<HTMLElement>(`[data-line="${line}"]`);
    if (row == null) continue;
    const r = read(row);
    if (top === undefined || r.top < top) top = r.top;
    if (bottom === undefined || r.bottom > bottom) bottom = r.bottom;
  }
  if (top === undefined || bottom === undefined) return null;
  // Translate viewport coords into the scroller's content frame: a row's offset
  // from the content origin is its viewport top minus the scroller's viewport
  // top, plus how far the content is scrolled.
  const origin = read(scroller).top - scroller.scrollTop;
  return { top: top - origin, height: Math.max(0, bottom - top) };
}

/** Params for the bracket-layer action: the SourceView host (`.diffview`, whose
 * shadow holds the rows and onto which the rail color var is set) and the spans
 * to draw. Undefined host no-ops until the view mounts. */
export interface BracketLayerParams {
  host: HTMLElement | undefined;
  spans: BracketSpan[];
}

/**
 * Svelte action on the bracket overlay layer (a child of the `.diff-plan` scroll
 * container). It positions each span as an absolutely-positioned
 * `[data-comment-bracket]` rail over the scroll content — so the rails scroll
 * with the rows without a scroll listener — reconciling rail count in place on
 * span change. The rail color var lives on the host's `.diffview` rule; since
 * the layer is a sibling of the host the action copies the resolved value onto
 * the layer so the rails read it.
 *
 * Rail offsets are content-relative; a reflow (window resize, fenced-code
 * re-highlight, the content-key repaint) moves the rows, which a ResizeObserver
 * on the host catches to re-measure. The overlay is decorative —
 * `pointer-events: none` keeps gutter `+`/line-selection clicks reaching the
 * library beneath it.
 */
export function bracketLayer(node: HTMLElement, params: BracketLayerParams) {
  node.dataset.commentBracketLayer = "";
  let current = params;
  let observedHost: HTMLElement | undefined;
  let observer: ResizeObserver | undefined;
  const scroller = node.parentElement;

  const measure = () => {
    const host = current.host;
    if (host == null || scroller == null) {
      node.replaceChildren();
      return;
    }
    // The color var is declared on the host's .diffview rule; mirror its resolved
    // value onto the layer so the sibling rails (which can't inherit from the
    // host) pick it up.
    const color = getComputedStyle(host).getPropertyValue(BAR_COLOR_VAR).trim();
    if (color !== "") node.style.setProperty(BAR_COLOR_VAR, color);

    // Reconcile rail count to the span count, reusing existing rail elements.
    const rails = node.children as HTMLCollectionOf<HTMLElement>;
    while (rails.length > current.spans.length) node.lastElementChild?.remove();
    while (rails.length < current.spans.length) {
      const rail = document.createElement("div");
      rail.dataset.commentBracket = "";
      node.appendChild(rail);
    }
    current.spans.forEach((span, i) => {
      const rail = rails[i]!;
      const box = bracketBox(host, scroller, span);
      if (box == null || box.height === 0) {
        rail.style.display = "none";
        return;
      }
      rail.style.display = "";
      rail.style.top = `${box.top}px`;
      rail.style.height = `${box.height}px`;
    });
  };

  const observe = (host: HTMLElement | undefined) => {
    if (host === observedHost) return;
    observer?.disconnect();
    observer = undefined;
    observedHost = host;
    if (host != null) {
      observer = new ResizeObserver(() => measure());
      observer.observe(host);
    }
  };

  observe(current.host);
  measure();

  return {
    update(next: BracketLayerParams) {
      current = next;
      observe(next.host);
      measure();
    },
    destroy() {
      observer?.disconnect();
    },
  };
}
