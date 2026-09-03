import type { RectReader } from "$lib/diffview/codeCopy.ts";
import { CELL_ATTR } from "$lib/diffview/rowTokens.ts";

/** A `[data-line]` row holding one `<span>` per token, concatenating to the
 * row's text — the stand-in DOM the inline-decoration suites drive shiki's
 * token structure with. */
export function row(line: number, tokens: string[]): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-line", String(line));
  for (const t of tokens) {
    const span = document.createElement("span");
    span.textContent = t;
    el.appendChild(span);
  }
  return el;
}

/** The `[data-content]` host wrapping the given rows, as SourceView renders them. */
export function root(...rows: HTMLElement[]): HTMLElement {
  const host = document.createElement("div");
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  for (const r of rows) content.appendChild(r);
  host.appendChild(content);
  return host;
}

/** A table row whose tokens are grouped into `[CELL_ATTR]` cell elements —
 * the shape a carded table row presents once its cells sit a level down. */
export function celledRow(line: number, cells: string[][]): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-line", String(line));
  for (const tokens of cells) {
    const cell = document.createElement("span");
    cell.setAttribute(CELL_ATTR, "");
    for (const t of tokens) {
      const span = document.createElement("span");
      span.textContent = t;
      cell.appendChild(span);
    }
    el.appendChild(cell);
  }
  return el;
}

/** Every `[data-file-ref]` element's text, in document order. */
export function fileRefTexts(host: HTMLElement): string[] {
  return [...host.querySelectorAll("[data-file-ref]")].map((el) => el.textContent ?? "");
}

/** The gutter/content column pair @pierre/diffs renders before any pass runs:
 * `[data-gutter]` and `[data-content]`, both already attached under `root`, for
 * callers to append their own cells/rows into. */
export function gutterContentRoot(): {
  root: HTMLElement;
  gutter: HTMLElement;
  content: HTMLElement;
} {
  const root = document.createElement("div");
  const gutter = document.createElement("div");
  gutter.setAttribute("data-gutter", "");
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  root.append(gutter, content);
  return { root, gutter, content };
}

/** Adds the library's annotation row for `line` and its gutter buffer,
 * immediately after that line's own cell in each column — wherever those now
 * sit. */
export function openComment(root: HTMLElement, line: number): void {
  const row = root.querySelector(`[data-content] [data-line="${line}"]`);
  const annotation = document.createElement("div");
  annotation.setAttribute("data-line-annotation", `0,${line}`);
  row?.parentElement?.insertBefore(annotation, row.nextSibling);
  const number = root.querySelector(`[data-gutter] [data-column-number="${line}"]`);
  const buffer = document.createElement("div");
  buffer.setAttribute("data-gutter-buffer", "annotation");
  number?.parentElement?.insertBefore(buffer, number.nextSibling);
}

/** Appends `lineCount` empty `[data-line]` rows (1-based) into `content`. */
export function fillLines(content: HTMLElement, lineCount: number): void {
  for (let n = 1; n <= lineCount; n++) {
    const row = document.createElement("div");
    row.setAttribute("data-line", String(n));
    content.appendChild(row);
  }
}

/** Stubs a scroller offset from its content origin (scrollTop 50, scrollLeft
 * 10, viewport top 5 / left 8) and a fixed content-space rect for every other
 * element — the fixture both `copyAnchor` and `pickRefHintAnchors` resolve
 * their "accounts for scroll" case through: content top 100 resolves to
 * scroller-relative top 145, right 300 to left 302. */
export function scrolledOffsetReader(scroller: HTMLElement): RectReader {
  scroller.scrollTop = 50;
  scroller.scrollLeft = 10;
  return (el) =>
    el === scroller
      ? { top: 5, bottom: 1000, left: 8, right: 400 }
      : { top: 100, bottom: 110, left: 100, right: 300 };
}
