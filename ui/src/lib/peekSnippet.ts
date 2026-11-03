// One section of the plan as the live view draws it, copied for the outline's peek.
// Copying the live render, rather than rendering the section again, keeps the peek exact
// in every theme: its fonts, heading sizes and code highlighting are the plan's own. It
// relies on neither view virtualizing, so every row of a section is in the DOM.

/** A section's 1-based, inclusive source lines. */
export interface SnippetLines {
  from: number;
  to: number;
}

// A live row's passing state, which the copy must not freeze.
const ROW_STATE = ["data-hovered", "data-selected-line", "data-caret-cursor"];

/**
 * The source view's rows for `lines`, gutter and all, in a shadow root that wears the
 * live root's sheets and theme. Comment rows are left out: their cards are slotted in
 * from the light DOM, which the copy does not carry. Null unless the view draws the
 * section's every row.
 */
export function sourceSnippet(host: HTMLElement, lines: SnippetLines): HTMLElement | null {
  const live = host.shadowRoot;
  const pre = live?.querySelector("pre");
  const code = pre?.querySelector("[data-code]");
  const gutter = code?.querySelector("[data-gutter]");
  const content = code?.querySelector("[data-content]");
  if (!live || !pre || !code || !gutter || !content) return null;
  const kept = sectionChildren(content, lines);
  if (kept === null) return null;

  const gutterCopy = shallow(gutter);
  const contentCopy = shallow(content);
  for (const i of kept) {
    const number = gutter.children[i];
    const row = content.children[i];
    if (number === undefined || row === undefined) return null;
    gutterCopy.append(deep(number));
    contentCopy.append(deep(row));
  }
  const codeCopy = shallow(code);
  codeCopy.append(gutterCopy, contentCopy);
  const preCopy = shallow(pre);
  preCopy.append(codeCopy);
  preCopy.style.setProperty("overflow", "hidden");
  settle(preCopy);
  const span = `span ${gridRows(contentCopy)}`;
  gutterCopy.style.setProperty("grid-row", span);
  contentCopy.style.setProperty("grid-row", span);

  const copy = document.createElement(host.tagName);
  copy.className = host.className;
  const shadow = copy.attachShadow({ mode: "open" });
  shadow.adoptedStyleSheets = live.adoptedStyleSheets;
  for (const child of live.children) {
    if (child === pre) shadow.append(preCopy);
    else if (child.matches("style, svg[data-icon-sprite]")) shadow.append(deep(child));
  }
  return copy;
}

/**
 * The preview's blocks that hold `lines`, in a copy of the live root, so its scoped rules
 * and properties reach them. Comment gaps close, since the comments stay in the plan. Null
 * when no block holds the section's heading.
 */
export function previewSnippet(root: HTMLElement, lines: SnippetLines): HTMLElement | null {
  const blocks = [...root.children].filter(
    (block) => sourceEnd(block) >= lines.from && sourceStart(block) <= lines.to,
  );
  const first = blocks[0];
  if (first === undefined || sourceStart(first) > lines.from) return null;
  const copy = shallow(root);
  copy.style.setProperty(
    "--preview-scale",
    getComputedStyle(root).getPropertyValue("--preview-scale"),
  );
  copy.append(...blocks.map(deep));
  for (const gap of copy.querySelectorAll("[data-preview-gap]")) gap.remove();
  hideFailedImages(copy);
  // `indeterminate` is a property, so no clone carries it.
  for (const box of copy.querySelectorAll<HTMLInputElement>('input[data-task="slashed"]')) {
    box.indeterminate = true;
  }
  return copy;
}

// The indices of `content`'s children from the heading's row through the section's last
// line of text, skipping comment rows, which draw no line. Null unless the rows run
// unbroken to the section's last line.
function sectionChildren(content: Element, lines: SnippetLines): number[] | null {
  const children = [...content.children];
  const start = children.findIndex((child) => drawnLines(child)[0] === lines.from);
  if (start === -1) return null;
  const kept: number[] = [];
  const drawn: number[] = [];
  for (const [offset, child] of children.slice(start).entries()) {
    const rows = drawnLines(child);
    const [first] = rows;
    if (first === undefined) continue;
    if (first > lines.to) break;
    kept.push(start + offset);
    drawn.push(...rows);
  }
  const unbroken = drawn.every((line, k) => line === lines.from + k);
  if (!unbroken || drawn.at(-1) !== lines.to) return null;
  while (kept.length > 1 && children[kept.at(-1) ?? 0]?.textContent?.trim() === "") kept.pop();
  return kept;
}

// The lines a content child draws: a row's own, or each of a card's rows'.
function drawnLines(child: Element): number[] {
  const rows = child.hasAttribute("data-line") ? [child] : child.querySelectorAll("[data-line]");
  return [...rows].map((row) => Number(row.getAttribute("data-line")));
}

// Strips what the copy must not show, and spans each card over the rows it still holds.
function settle(pre: HTMLElement): void {
  for (const row of pre.querySelectorAll("[data-line-annotation]")) row.remove();
  for (const attribute of ROW_STATE) {
    for (const row of pre.querySelectorAll(`[${attribute}]`)) row.removeAttribute(attribute);
  }
  for (const card of pre.querySelectorAll<HTMLElement>("[data-content] > :not([data-line])")) {
    card.style.setProperty("grid-row", `span ${card.children.length}`);
  }
  hideFailedImages(pre);
}

// As the live views do (inlineImages.ts, PlanPreview): a clone keeps no listener, and
// loads its images afresh.
function hideFailedImages(root: ParentNode): void {
  for (const image of root.querySelectorAll("img")) {
    image.addEventListener("error", () => {
      image.hidden = true;
    });
  }
}

function gridRows(content: Element): number {
  let rows = 0;
  for (const child of content.children)
    rows += child.hasAttribute("data-line") ? 1 : child.children.length;
  return rows;
}

function sourceStart(block: Element): number {
  return Number(block.getAttribute("data-source-start"));
}

function sourceEnd(block: Element): number {
  return Number(block.getAttribute("data-source-end"));
}

function shallow<T extends Element>(node: T): HTMLElement {
  return node.cloneNode(false) as HTMLElement;
}

function deep<T extends Node>(node: T): T {
  return node.cloneNode(true) as T;
}
