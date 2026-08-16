// Token-event handlers for the source view's link layer. The @pierre/diffs
// File view emits per-token pointer events carrying the token's line number and
// character range; these handlers resolve that to the span under the pointer and,
// on a hit, open the URL (click) or reveal a caret-themed tooltip and a
// pointer cursor (hover). No line content is mutated — the span map is keyed by
// line number, so this stays correct as the library virtualizes rows in and
// out. The URL-open effect is injected so the layer is unit-testable.
//
// The token's character range is only the first filter. Shiki emits a prose line
// as ONE token, so that range routinely covers the whole line: a link's affordance
// would then run the width of the row. What the pointer is over decides — see
// spanAtPointer — and for the same reason hover tracks pointer movement *within* a
// token rather than only its enter/leave.

import type { FileRefSpan, FileRefSpanMap } from "$lib/diffview/fileRefs.ts";
import type { LinkSpan, LinkSpanMap } from "$lib/diffview/links.ts";
import { rangeForSpan } from "$lib/diffview/searchHighlight.ts";

/** The slice of @pierre/diffs' TokenEventBase the link click handler reads. */
interface TokenClickProps {
  lineNumber: number;
  lineCharStart: number;
  lineCharEnd: number;
  tokenText: string;
}

/** TokenEventBase plus the token element the hover effect decorates and the
 * file-reference click anchors the preview to. */
interface TokenHoverProps extends TokenClickProps {
  tokenElement: HTMLElement;
}

export interface LinkHandlerDeps {
  /** Opens the link target. Production wires window.open(href, "_blank",
   * "noopener,noreferrer"); tests inject a spy. */
  openUrl(href: string): void;
}

/** The file-reference click affordance the composed handlers dispatch to
 * (EXC-687; click-to-open since EXC-840). No dep is dispatched on hover: the
 * override sheet highlights the tagged token, and a reference carrying a
 * `target` — one whose label hides its path — reveals it through the link
 * tooltip (EXC-954). A click on a resolved reference opens the excerpt popover
 * and consumes the event, so its line does not also open a comment. */
export interface FileRefClickDeps {
  /** A token over a resolved file reference was clicked — the view opens the
   * excerpt popover anchored to `tokenElement`. */
  onFileRefClick(ref: FileRefSpan, tokenElement: HTMLElement): void;
}

export interface LinkHandlers {
  onTokenClick(props: TokenHoverProps, event: MouseEvent): void;
  onTokenEnter(props: TokenHoverProps, event: PointerEvent): void;
  onTokenLeave(props: TokenHoverProps, event: PointerEvent): void;
}

/** Library options the token layer owns. Carried alongside the handlers so the
 * flag that keeps token interactions wired travels with them — a view spreads
 * this bag into its File options rather than re-deriving the flag itself. */
export interface TokenLibOptions {
  /** The library only infers token-event wiring from the handlers on the first
   * render; its renderer-options projection drops the handlers on every later
   * render, so the per-token `data-char` markers stop being emitted and token
   * clicks/hovers no longer resolve to a link span. Pinning it true keeps token
   * interactions live across re-renders. */
  useTokenTransformer: true;
}

/** The single token-handler object a view hands @pierre/diffs, bundled with the
 * race state and library flag that belong with it. The library accepts exactly
 * one onTokenEnter/onTokenLeave/onTokenClick, so every per-token affordance
 * composes here: a new affordance contributes its enter/leave/click inside
 * composeTokenHandlers, never in the view. */
export interface ComposedTokenHandlers {
  /** The one handler object passed straight to the library. */
  handlers: LinkHandlers;
  /** Library options the handlers require (the token-transformer flag). */
  libOptions: TokenLibOptions;
  /** Whether `event` is the most recent click consumed by a per-token
   * affordance — a link span or a file reference. The library fires
   * onTokenClick (this layer) before onLineClick for the same event, so a
   * view's row-click handler asks this to stand down on a consumed click —
   * the link opens (or the preview does) and the line does not also open a
   * comment. */
  wasLinkClick(event: Event): boolean;
}

/** Marks the hover tooltip so a stray instance can be cleared before a new one
 * is shown and so e2e can find it. */
const TOOLTIP_ATTR = "data-link-tooltip";

/** The element a token's tooltip mounts into: its shadow root (the diffview
 * shadow tree the library renders the code into) when it has one, else the
 * owner document's body — the fallback only matters in unit tests, where the
 * token element is unattached. */
function tooltipMount(tokenElement: HTMLElement): ParentNode {
  const root = tokenElement.getRootNode();
  if (root instanceof ShadowRoot) return root;
  return tokenElement.ownerDocument.body ?? tokenElement.ownerDocument;
}

/** Reveals the hover tooltip: a caret-surface bubble carrying the full target —
 * a link's href, or a file reference's path when its label hides it —
 * mounted in the token's root (the diffview shadow root) so it renders on
 * caret's surface inside the same tree as the code. Its colors come from the
 * host-level --diffs-link-tooltip-* bridge vars (declared once on the .diffview
 * rule in app.css), which inherit through the shadow boundary; its geometry and
 * type borrow caret's FND/type-scale tokens, which inherit the same way. The
 * reveal is motionless — no transition is set here. That is the integration
 * point for the motion tokens (--dur-micro / --ease-out), a deliberate follow-up.
 *
 * The bubble does not reposition on scroll (no scroll listener is added);
 * dismissal relies on hideTooltip from onTokenLeave. */
function showTooltip(tokenElement: HTMLElement, href: string): void {
  const mount = tooltipMount(tokenElement);
  hideTooltip(tokenElement);

  const tip = tokenElement.ownerDocument.createElement("div");
  tip.setAttribute(TOOLTIP_ATTR, "");
  tip.textContent = href;
  // Fixed positioning is viewport-relative, matching getBoundingClientRect, so
  // the bubble lands on the token regardless of how the shadow tree is scrolled.
  tip.style.cssText = [
    "position: fixed",
    "z-index: 10",
    "max-width: 80ch",
    "padding: 4px 8px",
    "border-radius: var(--radius-lg)",
    "background: var(--diffs-link-tooltip-bg)",
    "color: var(--diffs-link-tooltip-fg)",
    "border: 1px solid var(--diffs-link-tooltip-border)",
    "box-shadow: var(--shadow-card)",
    "font-family: var(--font-mono)",
    "font-size: var(--text-2xs)",
    "line-height: var(--leading-snug)",
    "white-space: nowrap",
    "overflow: hidden",
    "text-overflow: ellipsis",
    "pointer-events: none",
  ].join(";");

  mount.appendChild(tip);

  // Anchor just above the token's on-screen box; offsetHeight is known only once
  // the node is in the tree.
  const rect = tokenElement.getBoundingClientRect();
  tip.style.left = `${rect.left}px`;
  tip.style.top = `${rect.top - tip.offsetHeight - 6}px`;
}

/** Removes any tooltip in the token's root. Pairs with showTooltip; a no-op when
 * none is present. */
function hideTooltip(tokenElement: HTMLElement): void {
  for (const el of tooltipMount(tokenElement).querySelectorAll(`[${TOOLTIP_ATTR}]`)) el.remove();
}

type ColumnSpan = { startCol: number; endCol: number };

/** Whether a span's half-open [startCol, endCol) columns overlap the token's.
 * Half-open on both sides, so a token ending exactly at a span's startCol (or
 * starting exactly at its endCol) does not count. */
function overlapsToken(span: ColumnSpan, charStart: number, charEnd: number): boolean {
  return charStart < span.endCol && charEnd > span.startCol;
}

/**
 * Whether the pointer is over the span's rendered columns.
 *
 * Column overlap cannot answer this on its own: shiki emits a prose line as ONE
 * token, so a token's [lineCharStart, lineCharEnd) range routinely spans the
 * whole line and overlaps a span the pointer is nowhere near — which is what made
 * the entire row behave as the link. The span's own columns do have
 * geometry: rangeForSpan resolves them over the token's `data-line` row into the
 * boxes the label actually occupies, so the pointer is tested against those.
 *
 * Returns true when that geometry cannot be measured — no row, unresolvable
 * columns, or an environment without layout (happy-dom units) — leaving the
 * coarse column hit in force rather than dropping the affordance entirely.
 */
function pointerOverSpan(tokenElement: HTMLElement, span: ColumnSpan, event: MouseEvent): boolean {
  const row = tokenElement.closest("[data-line]");
  if (row === null) return true;
  const range = rangeForSpan(row, span.startCol, span.endCol);
  const rects = range === null ? [] : [...range.getClientRects()];
  if (rects.length === 0) return true;
  return rects.some(
    (r) =>
      event.clientX >= r.left &&
      event.clientX <= r.right &&
      event.clientY >= r.top &&
      event.clientY <= r.bottom,
  );
}

/** The span the pointer is actually over. Every affordance in this layer resolves
 * through here so none of them can outgrow the text it decorates. */
function spanAtPointer<T extends ColumnSpan>(
  spans: T[] | undefined,
  props: TokenHoverProps,
  event: MouseEvent,
): T | undefined {
  return spans?.find((s) => {
    if (!overlapsToken(s, props.lineCharStart, props.lineCharEnd)) return false;
    // A token that lies WITHIN the span's columns is the span, so the token box
    // the library already hit-tested is the hit area — decoration included, which
    // is what keeps a click on a file reference's icon (drawn as the token's own
    // ::before, left of its first character) opening that reference. Only a token
    // WIDER than the span — shiki's one-token prose line — needs narrowing.
    if (props.lineCharStart >= s.startCol && props.lineCharEnd <= s.endCol) return true;
    return pointerOverSpan(props.tokenElement, s, event);
  });
}

export function createLinkHandlers(spanMap: LinkSpanMap, deps: LinkHandlerDeps): LinkHandlers {
  const spanFor = (props: TokenHoverProps, event: MouseEvent): LinkSpan | undefined =>
    spanAtPointer(spanMap.get(props.lineNumber), props, event);

  return {
    onTokenClick(props, event) {
      const span = spanFor(props, event);
      if (span != null) deps.openUrl(span.href);
    },
    onTokenEnter(props, event) {
      const span = spanFor(props, event);
      // Also the pointer-moved-off-the-link case: this runs on every move within
      // the hovered token (see composeTokenHandlers), so a miss must retract the
      // tooltip and the cursor, not merely decline to show them.
      if (span == null) {
        hideTooltip(props.tokenElement);
        props.tokenElement.style.cursor = "";
        return;
      }
      showTooltip(props.tokenElement, span.href);
      props.tokenElement.style.cursor = "pointer";
    },
    onTokenLeave(props) {
      hideTooltip(props.tokenElement);
      props.tokenElement.style.cursor = "";
    },
  };
}

/**
 * Builds the single token-handler object a source view hands @pierre/diffs.
 * This is the one home for token-affordance composition: the library wires
 * exactly one onTokenEnter/onTokenLeave/onTokenClick, so a future per-token
 * affordance adds its enter/leave/click here, not in the view.
 *
 * Two affordances compose here today: the link layer (click opens the URL, hover
 * shows the tooltip) and the file-reference layer (click opens the excerpt
 * popover — see EXC-687/EXC-840; its highlight is CSS-only in the override
 * sheet, and enter/leave only show the tooltip for a reference whose display
 * text hides its path — a prose-labelled link, EXC-954). onTokenClick records
 * the event when a click lands on either a link span or a file reference; that
 * recorded event drives wasLinkClick, which a view's row-click handler reads to
 * stand down: the library fires this layer's onTokenClick before onLineClick
 * for the same event, so a clicked link opens (or a clicked reference previews)
 * and the line it sits on does not also open a comment composer.
 *
 * Returns undefined when neither layer is present — a read-only view then wires
 * no token handlers at all and the library renders plain.
 */
export function composeTokenHandlers(
  spanMap: LinkSpanMap | undefined,
  fileRefs: FileRefSpanMap | undefined,
  deps: LinkHandlerDeps & Partial<FileRefClickDeps>,
): ComposedTokenHandlers | undefined {
  const link = spanMap != null ? createLinkHandlers(spanMap, deps) : undefined;
  const hasFileRefs = fileRefs != null && fileRefs.size > 0;
  if (link === undefined && !hasFileRefs) return undefined;

  const fileRefAt = (props: TokenHoverProps, event: MouseEvent): FileRefSpan | undefined =>
    spanAtPointer(fileRefs?.get(props.lineNumber), props, event);

  // Reveal or retract the hover affordances for wherever the pointer sits now.
  // A reference emitted from a prose-labelled link hides its destination in the
  // display text, so hover is the only way to see it — the same tooltip surface a
  // link uses. A reference that shows its own path carries no target and keeps its
  // CSS-only hover.
  const applyHover = (props: TokenHoverProps, event: PointerEvent): void => {
    const ref = fileRefAt(props, event);
    if (ref?.target !== undefined) {
      showTooltip(props.tokenElement, ref.target);
      return;
    }
    if (link !== undefined) {
      link.onTokenEnter(props, event); // shows on a hit, retracts on a miss
      return;
    }
    hideTooltip(props.tokenElement);
  };

  // A token is often a whole prose line, so the pointer crosses in and out of a
  // link's columns *within* one token and the library fires no further
  // enter/leave. Entering arms a pointermove that re-resolves the affordance on
  // every move; leaving disarms it. Only one token is hovered at a time, so a
  // single armed listener covers the view.
  let armed: { element: HTMLElement; move: (event: PointerEvent) => void } | undefined;
  const disarm = (): void => {
    armed?.element.removeEventListener("pointermove", armed.move);
    armed = undefined;
  };

  let consumedClickEvent: Event | undefined;
  return {
    handlers: {
      onTokenEnter(props, event) {
        disarm();
        const move = (moved: PointerEvent) => applyHover(props, moved);
        props.tokenElement.addEventListener("pointermove", move);
        armed = { element: props.tokenElement, move };
        applyHover(props, event);
      },
      onTokenLeave(props, event) {
        disarm();
        // The pointer left the token: retract whatever was showing. A reference
        // tooltip has no link handler behind it, so hide unconditionally too.
        link?.onTokenLeave(props, event);
        hideTooltip(props.tokenElement);
      },
      onTokenClick(props, event) {
        const ref = fileRefAt(props, event);
        if (ref !== undefined) {
          consumedClickEvent = event;
          deps.onFileRefClick?.(ref, props.tokenElement);
          return;
        }
        if (link === undefined) return;
        if (spanAtPointer(spanMap?.get(props.lineNumber), props, event) !== undefined) {
          consumedClickEvent = event;
        }
        link.onTokenClick(props, event);
      },
    },
    libOptions: { useTokenTransformer: true },
    wasLinkClick: (event) => event === consumedClickEvent,
  };
}
