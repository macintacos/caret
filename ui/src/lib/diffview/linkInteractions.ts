// Token-event handlers for the source view's link layer. The @pierre/diffs
// File view emits per-token pointer events carrying the token's line number and
// character range; these handlers hit-test that range against the link span map
// and, on a hit, open the URL (click) or reveal a caret-themed tooltip and a
// pointer cursor (hover). No line content is mutated — the span map is keyed by
// line number, so this stays correct as the library virtualizes rows in and
// out. The URL-open effect is injected so the layer is unit-testable.

import type { FileRefSpan, FileRefSpanMap } from "$lib/diffview/fileRefs.ts";
import type { LinkSpan, LinkSpanMap } from "$lib/diffview/links.ts";

/** The slice of @pierre/diffs' TokenEventBase the click handler reads. */
interface TokenClickProps {
  lineNumber: number;
  lineCharStart: number;
  lineCharEnd: number;
  tokenText: string;
}

/** TokenEventBase plus the token element the hover effect decorates. */
interface TokenHoverProps extends TokenClickProps {
  tokenElement: HTMLElement;
}

export interface LinkHandlerDeps {
  /** Opens the link target. Production wires window.open(href, "_blank",
   * "noopener,noreferrer"); tests inject a spy. */
  openUrl(href: string): void;
}

/** The file-reference hover affordance the composed handlers dispatch to
 * (EXC-687). Hover-only: a file reference has no click action, so a click on one
 * falls through to the normal line-click (opening a comment on its line). */
export interface FileRefHoverDeps {
  /** A token starting a resolved file reference was entered — the view reveals
   * the excerpt popover anchored to `tokenElement`. */
  onFileRefEnter(ref: FileRefSpan, tokenElement: HTMLElement): void;
  /** The file-reference token was left — the view dismisses the popover. */
  onFileRefLeave(): void;
}

export interface LinkHandlers {
  onTokenClick(props: TokenClickProps, event: MouseEvent): void;
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
  /** Whether `event` is the most recent click that landed on a link span. The
   * library fires onTokenClick (this layer) before onLineClick for the same
   * event, so a view's row-click handler asks this to stand down on a link
   * click — the link opens and the line does not also open a comment. */
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

/** Reveals the hover tooltip: a caret-surface bubble carrying the full href,
 * mounted in the token's root (the diffview shadow root) so it renders on
 * caret's surface inside the same tree as the code. Its colors come from the
 * host-level --diffs-link-tooltip-* bridge vars (declared once on the .diffview
 * rule in app.css), which inherit through the shadow boundary; its geometry and
 * type borrow caret's FND/type-scale tokens, which inherit the same way. The
 * reveal is motionless — no transition is set here. That is the integration
 * point for the motion tokens (--dur-fast / --ease-out), a deliberate follow-up.
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

/** Returns the first column span on the line whose range overlaps the token's
 * half-open [charStart, charEnd) range, or undefined if the token touches none.
 * Ranges are 0-based and half-open, so a token ending exactly at a span's
 * startCol (or starting exactly at its endCol) does not count as a hit. Generic
 * over the span shape so both link and file-reference spans hit-test through it. */
export function hitTestSpan<T extends { startCol: number; endCol: number }>(
  spans: T[],
  charStart: number,
  charEnd: number,
): T | undefined {
  return spans.find((s) => charStart < s.endCol && charEnd > s.startCol);
}

export function createLinkHandlers(spanMap: LinkSpanMap, deps: LinkHandlerDeps): LinkHandlers {
  const spanFor = (props: TokenClickProps): LinkSpan | undefined => {
    const lineSpans = spanMap.get(props.lineNumber);
    if (lineSpans == null) return undefined;
    return hitTestSpan(lineSpans, props.lineCharStart, props.lineCharEnd);
  };

  return {
    onTokenClick(props) {
      const span = spanFor(props);
      if (span != null) deps.openUrl(span.href);
    },
    onTokenEnter(props) {
      const span = spanFor(props);
      if (span == null) return;
      showTooltip(props.tokenElement, span.href);
      props.tokenElement.style.cursor = "pointer";
    },
    onTokenLeave(props) {
      if (spanFor(props) == null) return;
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
 * shows the tooltip) and the file-reference layer (hover reveals the excerpt
 * popover — see EXC-687). The link's onTokenClick is wrapped to record the event
 * when a click lands on a link span; that recorded event drives wasLinkClick,
 * which a view's row-click handler reads to stand down: the library fires this
 * layer's onTokenClick before onLineClick for the same event, so a clicked link
 * opens and the line it sits on does not also open a comment composer. File
 * references are hover-only, so a click on one falls through to the row click.
 *
 * Returns undefined when neither layer is present — a read-only view then wires
 * no token handlers at all and the library renders plain.
 */
export function composeTokenHandlers(
  spanMap: LinkSpanMap | undefined,
  fileRefs: FileRefSpanMap | undefined,
  deps: LinkHandlerDeps & Partial<FileRefHoverDeps>,
): ComposedTokenHandlers | undefined {
  const link = spanMap != null ? createLinkHandlers(spanMap, deps) : undefined;
  const hasFileRefs = fileRefs != null && fileRefs.size > 0;
  if (link === undefined && !hasFileRefs) return undefined;

  const fileRefAt = (
    lineNumber: number,
    charStart: number,
    charEnd: number,
  ): FileRefSpan | undefined => {
    const spans = fileRefs?.get(lineNumber);
    return spans === undefined ? undefined : hitTestSpan(spans, charStart, charEnd);
  };

  let linkClickEvent: Event | undefined;
  return {
    handlers: {
      onTokenEnter(props, event) {
        link?.onTokenEnter(props, event);
        const ref = fileRefAt(props.lineNumber, props.lineCharStart, props.lineCharEnd);
        if (ref !== undefined) deps.onFileRefEnter?.(ref, props.tokenElement);
      },
      onTokenLeave(props, event) {
        link?.onTokenLeave(props, event);
        if (fileRefAt(props.lineNumber, props.lineCharStart, props.lineCharEnd) !== undefined) {
          deps.onFileRefLeave?.();
        }
      },
      onTokenClick(props, event) {
        if (link === undefined) return;
        const spans = spanMap?.get(props.lineNumber);
        if (spans != null && hitTestSpan(spans, props.lineCharStart, props.lineCharEnd) != null) {
          linkClickEvent = event;
        }
        link.onTokenClick(props, event);
      },
    },
    libOptions: { useTokenTransformer: true },
    wasLinkClick: (event) => event === linkClickEvent,
  };
}
