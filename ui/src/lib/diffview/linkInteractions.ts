// Token-event handlers for the source view's link layer. The @pierre/diffs
// File view emits per-token pointer events carrying the token's line number and
// character range; these handlers hit-test that range against the link span map
// and, on a hit, open the URL (click) or decorate the token with a tooltip and
// pointer cursor (hover). No line content is mutated — the span map is keyed by
// line number, so this stays correct as the library virtualizes rows in and
// out. The URL-open effect is injected so the layer is unit-testable.

import type { LinkSpan, LinkSpanMap } from "./links.ts";

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

export interface LinkHandlers {
  onTokenClick(props: TokenClickProps, event: MouseEvent): void;
  onTokenEnter(props: TokenHoverProps, event: PointerEvent): void;
  onTokenLeave(props: TokenHoverProps, event: PointerEvent): void;
}

/** Returns the first link span on the line whose range overlaps the token's
 * half-open [charStart, charEnd) range, or undefined if the token touches no
 * link. Ranges are 0-based and half-open, so a token ending exactly at a span's
 * startCol (or starting exactly at its endCol) does not count as a hit. */
export function hitTestSpan(
  spans: LinkSpan[],
  charStart: number,
  charEnd: number,
): LinkSpan | undefined {
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
      props.tokenElement.setAttribute("title", span.href);
      props.tokenElement.style.cursor = "pointer";
    },
    onTokenLeave(props) {
      if (spanFor(props) == null) return;
      props.tokenElement.removeAttribute("title");
      props.tokenElement.style.cursor = "";
    },
  };
}
