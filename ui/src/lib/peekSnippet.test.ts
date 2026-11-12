import "@ui/support/setup.ts";
import { describe, expect, test } from "bun:test";

import { previewSnippet, sourceSnippet } from "$lib/peekSnippet.ts";

function el(tag: string, attrs: Record<string, string> = {}, text = ""): HTMLElement {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.textContent = text;
  return node;
}

// The source view as @pierre/diffs draws this plan, one gutter cell per content row:
//   1 # Plan   2 (blank)   3 ## Intake   4-6 a fenced block, carded, with a comment on 5
//   (a comment on 6)   7 (blank)   8 ## Next   9 (blank)
function sourceView() {
  const host = el("div", { class: "diffview" });
  const shadow = host.attachShadow({ mode: "open" });
  const sheet = new CSSStyleSheet();
  shadow.adoptedStyleSheets = [sheet];
  const theme = el("style", { "data-theme-css": "" }, ":host { --diffs-token: red; }");
  const pre = el("pre", {
    "data-file": "",
    style: "--diffs-min-number-column-width-default: 4ch;",
  });
  const code = el("code", { "data-code": "" });
  const gutter = el("div", { "data-gutter": "", style: "grid-row: span 11" });
  const content = el("div", { "data-content": "", style: "grid-row: span 11" });
  const cell = (n: number) => el("div", { "data-column-number": String(n) }, String(n));
  const line = (n: number, text: string) => el("div", { "data-line": String(n) }, text);
  const pair = (g: HTMLElement, c: HTMLElement) => {
    gutter.append(g);
    content.append(c);
  };
  pair(cell(1), line(1, "# Plan"));
  pair(cell(2), line(2, ""));
  pair(cell(3), line(3, "## Intake"));
  const gutterCard = el("div", { "data-code-card-gutter": "4", style: "display: contents;" });
  const comment = () => el("div", { "data-line-annotation": "0,5" });
  gutterCard.append(cell(4), cell(5), comment(), cell(6));
  const card = el("div", { "data-code-card": "4", style: "grid-row: span 4;" });
  card.append(line(4, "```ts"), line(5, "x"), comment(), line(6, "```"));
  pair(gutterCard, card);
  pair(el("div", { "data-line-annotation": "0,6" }), el("div", { "data-line-annotation": "0,6" }));
  pair(cell(7), line(7, ""));
  pair(cell(8), line(8, "## Next"));
  pair(cell(9), line(9, ""));
  code.append(gutter, content);
  pre.append(code);
  shadow.append(theme, pre);
  return { host, sheet, content };
}

const INTAKE = { from: 3, to: 7 };

function columns(snippet: HTMLElement) {
  const shadow = snippet.shadowRoot;
  const gutter = shadow?.querySelector<HTMLElement>("[data-gutter]");
  const content = shadow?.querySelector<HTMLElement>("[data-content]");
  if (!shadow || !gutter || !content) throw new Error("no columns in the snippet");
  return { shadow, gutter, content };
}

describe("sourceSnippet", () => {
  test("copies the section's rows and their line numbers, index for index", () => {
    const snippet = sourceSnippet(sourceView().host, INTAKE);
    if (!snippet) throw new Error("no snippet");
    const { gutter, content } = columns(snippet);
    const lines = [...content.querySelectorAll("[data-line]")].map((r) =>
      r.getAttribute("data-line"),
    );
    const numbers = [...gutter.querySelectorAll("[data-column-number]")].map((c) => c.textContent);
    expect(lines).toEqual(["3", "4", "5", "6"]);
    expect(numbers).toEqual(["3", "4", "5", "6"]);
  });

  test("ends on the section's last line of text, leaving the blank lines before the next heading", () => {
    const { host, content } = sourceView();
    content.querySelector('[data-line="7"]')?.replaceChildren("Retain a week.");
    const snippet = sourceSnippet(host, INTAKE);
    if (!snippet) throw new Error("no snippet");
    const last = columns(snippet).content.lastElementChild;
    expect(last?.getAttribute("data-line")).toBe("7");
  });

  test("keeps a card whole, and spans it and each column over the grid rows they copy", () => {
    const snippet = sourceSnippet(sourceView().host, INTAKE);
    if (!snippet) throw new Error("no snippet");
    const { content, gutter } = columns(snippet);
    const card = content.querySelector<HTMLElement>("[data-code-card]");
    expect(card?.children.length).toBe(3);
    expect(card?.style.getPropertyValue("grid-row")).toBe("span 3");
    expect(content.style.getPropertyValue("grid-row")).toBe("span 4");
    expect(gutter.style.getPropertyValue("grid-row")).toBe("span 4");
  });

  test("leaves comment rows out, since their cards live outside the shadow root", () => {
    const snippet = sourceSnippet(sourceView().host, INTAKE);
    if (!snippet) throw new Error("no snippet");
    expect(snippet.shadowRoot?.querySelector("[data-line-annotation]")).toBeNull();
  });

  test("drops the live rows' hover, cursor and selection", () => {
    const { host, content } = sourceView();
    content.querySelector('[data-line="3"]')?.setAttribute("data-hovered", "");
    content.querySelector('[data-line="5"]')?.setAttribute("data-selected-line", "single");
    content.querySelector('[data-line="7"]')?.setAttribute("data-caret-cursor", "");
    const snippet = sourceSnippet(host, INTAKE);
    if (!snippet) throw new Error("no snippet");
    const marked = snippet.shadowRoot?.querySelector(
      "[data-hovered], [data-selected-line], [data-caret-cursor]",
    );
    expect(marked).toBeNull();
  });

  test("wears the live view's class, sheets and theme", () => {
    const { host, sheet } = sourceView();
    const snippet = sourceSnippet(host, INTAKE);
    if (!snippet) throw new Error("no snippet");
    expect(snippet.className).toBe("diffview");
    expect(snippet.shadowRoot?.adoptedStyleSheets).toEqual([sheet]);
    expect(snippet.shadowRoot?.querySelector("style[data-theme-css]")?.textContent).toBe(
      ":host { --diffs-token: red; }",
    );
  });

  test("leaves the live view as it was", () => {
    const { host, content } = sourceView();
    sourceSnippet(host, INTAKE);
    expect(content.children.length).toBe(8);
    expect(content.querySelectorAll("[data-line]").length).toBe(9);
  });

  test("hides a copied image that fails to load, as the live view hides its own", () => {
    const { host, content } = sourceView();
    content.querySelector('[data-line="5"]')?.append(el("img", { "data-md-image": "" }));
    const image = sourceSnippet(host, INTAKE)?.shadowRoot?.querySelector("img");
    image?.dispatchEvent(new Event("error"));
    expect(image?.hidden).toBe(true);
  });

  test("gives a copied image that was still loading its room once it loads", () => {
    const { host, content } = sourceView();
    content.querySelector('[data-line="5"]')?.append(el("img", { "data-md-image": "" }));
    const image = sourceSnippet(host, INTAKE)?.shadowRoot?.querySelector("img");
    image?.dispatchEvent(new Event("load"));
    expect(image?.hasAttribute("data-md-image-loaded")).toBe(true);
  });

  test("is null when the heading's row is not drawn", () => {
    expect(sourceSnippet(sourceView().host, { from: 42, to: 50 })).toBeNull();
    expect(sourceSnippet(el("div"), INTAKE)).toBeNull();
  });

  test("is null when the section runs past the rows drawn", () => {
    expect(sourceSnippet(sourceView().host, { from: 8, to: 12 }) === null).toBe(true);
  });

  test("is null when a row inside the section is not drawn", () => {
    const { host, content } = sourceView();
    content.querySelector('[data-line="7"]')?.remove();
    expect(sourceSnippet(host, { from: 3, to: 8 }) === null).toBe(true);
  });
});

// The preview of the same plan: one block per rendered construct, with a comment's gap
// opened inside the code block's.
function previewRoot(): HTMLElement {
  const root = el("div", { class: "plan-preview svelte-x1", style: "--file-ref-icon: none;" });
  const block = (start: number, end: number, html: string) => {
    const wrap = el("div", { "data-source-start": String(start), "data-source-end": String(end) });
    wrap.innerHTML = html;
    root.append(wrap);
  };
  block(1, 1, "<h1>Plan</h1>");
  block(3, 3, "<h2>Intake</h2>");
  block(
    4,
    6,
    '<span data-source-code data-source-line="5"></span><pre><code>x</code></pre><span data-preview-gap style="height: 40px"></span>',
  );
  block(7, 7, '<ul><li><input type="checkbox" data-task="slashed"> half</li></ul>');
  block(8, 8, "<h2>Next</h2>");
  return root;
}

describe("previewSnippet", () => {
  test("copies the blocks whose source lines meet the section", () => {
    const snippet = previewSnippet(previewRoot(), INTAKE);
    const spans = [...(snippet?.children ?? [])].map((b) => b.getAttribute("data-source-start"));
    expect(spans).toEqual(["3", "4", "7"]);
  });

  test("wears the live root's class and properties", () => {
    const snippet = previewSnippet(previewRoot(), INTAKE);
    expect(snippet?.className).toBe("plan-preview svelte-x1");
    expect(snippet?.style.getPropertyValue("--file-ref-icon")).toBe("none");
  });

  test("closes the comments' gaps, since the comments stay in the plan", () => {
    const snippet = previewSnippet(previewRoot(), INTAKE);
    expect(snippet?.querySelector("[data-preview-gap]")).toBeNull();
  });

  test("marks a slashed task box indeterminate, as the live one is", () => {
    const box = previewSnippet(previewRoot(), INTAKE)?.querySelector<HTMLInputElement>(
      'input[data-task="slashed"]',
    );
    expect(box?.indeterminate).toBe(true);
  });

  test("leaves the live preview as it was", () => {
    const root = previewRoot();
    previewSnippet(root, INTAKE);
    expect(root.children.length).toBe(5);
    expect(root.querySelector("[data-preview-gap]")).not.toBeNull();
  });

  test("hides a copied image that fails to load, as the live preview hides its own", () => {
    const root = previewRoot();
    root.querySelector("h2")?.after(el("img"));
    const image = previewSnippet(root, INTAKE)?.querySelector("img");
    image?.dispatchEvent(new Event("error"));
    expect(image?.hidden).toBe(true);
  });

  test("is null when no block holds the heading", () => {
    expect(previewSnippet(previewRoot(), { from: 42, to: 50 })).toBeNull();
  });
});
