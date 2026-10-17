import "@ui/support/mount.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { flushSync, mount, unmount } from "svelte";

import { until } from "@test/support/poll.ts";
import { render } from "@ui/support/mount.ts";
import { reactiveProps } from "@ui/support/props.svelte.ts";
import { selectText } from "@ui/support/selection.ts";
import { CUSTOM_KEYWORD, customThemeSource } from "@ui/support/theme-file.ts";
import PlanPreview from "@/components/PlanPreview.svelte";
import {
  buildFileRefLayer,
  type FileRefSpan,
  type FileRefSpanMap,
  mergeFileRefSpans,
} from "$lib/diffview/fileRefs.ts";
import { buildLinkLayer } from "$lib/diffview/links.ts";
import { renderPlanMarkdown } from "$lib/planMarkdown.ts";
import type { TextPoint } from "$lib/previewLines.ts";
import { type PreviewFileRef, previewFileRefs } from "$lib/previewRefs.ts";
import { addTheme, replaceTheme, type ThemeId } from "$lib/theme.ts";
import { buildFileTheme } from "$lib/theme-file.ts";

function checkbox(target: HTMLElement, selector: string): HTMLInputElement {
  return target.querySelector(selector) as HTMLInputElement;
}

describe("PlanPreview", () => {
  test("marks a slashed task's checkbox indeterminate", () => {
    const { target, flush } = render(PlanPreview, {
      html: renderPlanMarkdown("- [/] half\n- [x] done\n").html,
    });
    flush();

    expect(checkbox(target, 'input[data-task="slashed"]').indeterminate).toBe(true);
    expect(checkbox(target, "input:checked").indeterminate).toBe(false);
  });

  test("marks a slashed task that arrives with new html", () => {
    const props = reactiveProps({ html: renderPlanMarkdown("plain\n").html });
    const { target, flush } = render(PlanPreview, props);
    flush();

    props.html = renderPlanMarkdown("- [/] later\n").html;
    flush();

    expect(checkbox(target, 'input[data-task="slashed"]').indeterminate).toBe(true);
  });

  test("hides an image that fails to load", () => {
    const { target, flush } = render(PlanPreview, {
      html: renderPlanMarkdown("![shot](https://example.com/a.png)\n").html,
    });
    flush();

    const img = target.querySelector("img") as HTMLImageElement;
    img.dispatchEvent(new Event("error"));

    expect(img.hidden).toBe(true);
  });

  test("keeps the source-mapped blocks as direct children of the container", () => {
    const { target, flush } = render(PlanPreview, {
      html: renderPlanMarkdown("# Title\n\nBody\n").html,
    });
    flush();

    const container = target.querySelector(".plan-preview") as HTMLElement;
    const blocks = [...container.children];
    expect(blocks.length).toBe(2);
    expect(blocks.every((b) => b.hasAttribute("data-source-start"))).toBe(true);
  });

  test("paints a code block plain, then highlights it with the same text", async () => {
    const plan = renderPlanMarkdown("```ts\nconst x: number = 1;\n```\n");
    const { target, flush } = render(PlanPreview, {
      html: plan.html,
      codeLanguages: plan.codeLanguages,
      themeId: "caret-dark",
    });
    flush();
    const code = codeOf(target);
    const text = code.textContent;
    expect(code.children.length).toBe(0);

    expect(await until(() => code.children.length > 0)).toBe(true);

    expect(code.textContent).toBe(text);
    expect(colours(code).size).toBeGreaterThan(1);
  });

  test("leaves an unknown-language block and a bare block as one text node", async () => {
    const plan = renderPlanMarkdown(
      "```nosuchlang\nconst x = 1;\n```\n\n```\nconst y = 2;\n```\n\n```ts\nconst z = 3;\n```\n",
    );
    const { target, flush } = render(PlanPreview, {
      html: plan.html,
      codeLanguages: plan.codeLanguages,
      themeId: "caret-dark",
    });
    flush();
    const [unknown, bare, ts] = [...target.querySelectorAll("pre code")];
    // The pass runs in document order, so the last block highlighted means the rest were passed.
    expect(await until(() => ts?.querySelector("span") != null)).toBe(true);

    for (const code of [unknown, bare])
      expect([...(code?.childNodes ?? [])].map((n) => n.nodeType)).toEqual([Node.TEXT_NODE]);
  });

  test("repaints the highlighted spans when the theme changes", async () => {
    const plan = renderPlanMarkdown("```ts\nconst x: number = 1;\n```\n");
    const props = reactiveProps({
      html: plan.html,
      codeLanguages: plan.codeLanguages,
      themeId: "caret-dark" as ThemeId,
    });
    const { target, flush } = render(PlanPreview, props);
    flush();
    const code = codeOf(target);
    expect(await until(() => code.children.length > 0)).toBe(true);
    const dark = [...colours(code)];

    props.themeId = "caret-light";
    flush();

    expect(await until(() => [...colours(code)].join() !== dark.join())).toBe(true);
  });

  test("repaints the highlighted spans when the showing custom theme is replaced", async () => {
    const source = await customThemeSource("preview-replaced", "dark");
    const id = addTheme(buildFileTheme(source));
    const plan = renderPlanMarkdown("```ts\nconst x = 1;\n```\n");
    const { target, flush } = render(PlanPreview, {
      html: plan.html,
      codeLanguages: plan.codeLanguages,
      themeId: id,
    });
    flush();
    const code = codeOf(target);
    const has = (hex: string) => [...colours(code)].some((c) => c.toLowerCase() === hex);
    expect(await until(() => has(CUSTOM_KEYWORD))).toBe(true);

    const replacement = "#aa11cc";
    replaceTheme(
      buildFileTheme({ ...source, syntax: { ...source.syntax, keyword: { color: replacement } } }),
    );
    flush();

    expect(await until(() => has(replacement), 1000)).toBe(true);
  });

  test("marks a block soft-wrapped while its fence line is in reflowedBlocks", () => {
    const plan = renderPlanMarkdown("```ts\nconst x = 1;\n```\n");
    const props = reactiveProps({
      html: plan.html,
      codeLanguages: plan.codeLanguages,
      reflowedBlocks: new Set([1]) as ReadonlySet<number>,
    });
    const { target, flush } = render(PlanPreview, props);
    flush();
    const pre = target.querySelector("pre") as HTMLElement;
    expect(pre.hasAttribute("data-code-reflow")).toBe(true);

    props.reflowedBlocks = new Set();
    flush();

    expect(pre.hasAttribute("data-code-reflow")).toBe(false);
  });
});

const PLAN = "See `src/a.ts` and [the doc](src/b.ts).\n";

function refsFor(text: string): PreviewFileRef[] {
  const layer = buildLinkLayer(text);
  const refs: FileRefSpanMap = new Map();
  for (const [line, spans] of mergeFileRefSpans(buildFileRefLayer(layer.text), layer.fileRefs))
    refs.set(
      line,
      spans.map((s) => ({ ...s, kind: "file" as const })),
    );
  return previewFileRefs(refs, layer.text);
}

describe("PlanPreview file references", () => {
  const tags = (target: HTMLElement) =>
    [...target.querySelectorAll(".plan-preview [data-file-ref]")].map((el) => el.textContent);

  afterEach(() => {
    for (const el of document.body.querySelectorAll("[data-link-tooltip]")) el.remove();
  });

  test("wraps each resolved reference after mount", () => {
    const { target, flush } = render(PlanPreview, {
      html: renderPlanMarkdown(PLAN).html,
      fileRefs: refsFor(PLAN),
    });
    flush();

    expect(tags(target)).toEqual(["src/a.ts", "the doc"]);
  });

  test("re-tags the new DOM when the html changes", () => {
    const next = "Now `src/c.ts`.\n";
    const props = reactiveProps({ html: renderPlanMarkdown(PLAN).html, fileRefs: refsFor(PLAN) });
    const { target, flush } = render(PlanPreview, props);
    flush();

    props.html = renderPlanMarkdown(next).html;
    props.fileRefs = refsFor(next);
    flush();

    expect(tags(target)).toEqual(["src/c.ts"]);
  });

  test("tags references that resolve after mount", () => {
    const props = reactiveProps({
      html: renderPlanMarkdown(PLAN).html,
      fileRefs: [] as PreviewFileRef[],
    });
    const { target, flush } = render(PlanPreview, props);
    flush();
    expect(tags(target)).toEqual([]);

    props.fileRefs = refsFor(PLAN);
    flush();

    expect(tags(target)).toEqual(["src/a.ts", "the doc"]);
  });

  test("a click on a reference hands its span and element over and cancels the default", () => {
    const calls: [FileRefSpan, HTMLElement][] = [];
    const { target, flush } = render(PlanPreview, {
      html: renderPlanMarkdown(PLAN).html,
      fileRefs: refsFor(PLAN),
      onFileRefClick: (ref: FileRefSpan, el: HTMLElement) => calls.push([ref, el]),
    });
    flush();
    const el = target.querySelector("[data-file-ref]") as HTMLElement;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });

    el.dispatchEvent(click);

    expect(calls.length).toBe(1);
    expect(calls[0]?.[0].path).toBe("src/a.ts");
    expect(calls[0]?.[1] === el).toBe(true);
    expect(click.defaultPrevented).toBe(true);
  });

  test("a click on plain text opens no file", () => {
    let calls = 0;
    const { target, flush } = render(PlanPreview, {
      html: renderPlanMarkdown(PLAN).html,
      fileRefs: refsFor(PLAN),
      onFileRefClick: () => calls++,
    });
    flush();

    (target.querySelector(".plan-preview p") as HTMLElement).click();

    expect(calls).toBe(0);
  });

  test("hovering a reference that hides its path shows the path until the pointer leaves", () => {
    const { target, flush } = render(PlanPreview, {
      html: renderPlanMarkdown(PLAN).html,
      fileRefs: refsFor(PLAN),
    });
    flush();
    const label = [...target.querySelectorAll("[data-file-ref]")][1] as HTMLElement;
    const tips = () => [...document.body.querySelectorAll("[data-link-tooltip]")];

    label.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    expect(tips().map((t) => t.textContent)).toEqual(["src/b.ts"]);

    label.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
    expect(tips().length).toBe(0);
  });

  test("a hovered reference's tooltip goes when the html is replaced", () => {
    const props = reactiveProps({ html: renderPlanMarkdown(PLAN).html, fileRefs: refsFor(PLAN) });
    const { target, flush } = render(PlanPreview, props);
    flush();
    const label = [...target.querySelectorAll("[data-file-ref]")][1] as HTMLElement;
    label.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));

    props.html = renderPlanMarkdown("Plain.\n").html;
    props.fileRefs = [];
    flush();

    expect(document.body.querySelectorAll("[data-link-tooltip]").length).toBe(0);
  });
});

function codeOf(target: HTMLElement): HTMLElement {
  return target.querySelector("pre code") as HTMLElement;
}

function colours(code: Element): Set<string> {
  return new Set(
    [...code.querySelectorAll<HTMLElement>("[style]")].map((span) => span.style.color),
  );
}

describe("PlanPreview text comments", () => {
  afterEach(() => {
    document.getSelection()?.removeAllRanges();
  });

  /** A stand-in for the layout: the row at height y starts line y. */
  const rowAt = (y: number): TextPoint => ({ line: y, column: 0 });

  function setup(text: string) {
    const rows: [TextPoint, TextPoint][] = [];
    const drags: (TextPoint | null)[] = [];
    let refClicks = 0;
    const { target, flush } = render(PlanPreview, {
      html: renderPlanMarkdown(text).html,
      fileRefs: refsFor(text),
      onFileRefClick: () => refClicks++,
      rowAt,
      onTextComment: (from: TextPoint, to: TextPoint) => rows.push([from, to]),
      onCommentDrag: (anchor: TextPoint | null) => drags.push(anchor),
    });
    flush();
    const root = target.querySelector(".plan-preview") as HTMLElement;
    return { root, rows, drags, refClicks: () => refClicks, flush };
  }

  const select = (node: Node, start: number, end = start): Range =>
    selectText([node, start], [node, end]);

  const click = (el: Element, init: MouseEventInit = {}) =>
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));

  const press = (el: Element, init: PointerEventInit = {}) =>
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, ...init }));
  const move = (init: PointerEventInit = {}) =>
    window.dispatchEvent(new PointerEvent("pointermove", { buttons: 1, ...init }));
  const release = (init: PointerEventInit = {}) =>
    window.dispatchEvent(new PointerEvent("pointerup", { button: 0, ...init }));

  /** A press and release at height `y` on `el`, and the click they fire. */
  function clickAt(el: Element, y: number, init: PointerEventInit = {}) {
    press(el, { clientY: y, ...init });
    release({ clientY: y, ...init });
    click(el, { clientY: y, ...init });
  }

  function outsideText(): Node {
    const outside = document.createElement("p");
    outside.textContent = "outside the preview";
    document.body.append(outside);
    return outside.firstChild as Node;
  }

  const textOf = (root: Element, selector: string) =>
    document
      .createTreeWalker(root.querySelector(selector) as Element, NodeFilter.SHOW_TEXT)
      .nextNode() as Node;

  test("a click reports the row under the pointer as both ends", () => {
    const { root, rows } = setup("Plain words here.\n");

    clickAt(root.querySelector("p") as Element, 7);

    expect(rows).toEqual([[rowAt(7), rowAt(7)]]);
  });

  test("a press that wanders within its row is a click on it", () => {
    const { root, rows, drags } = setup("Plain words here.\n");

    press(root, { clientX: 1, clientY: 7 });
    move({ clientX: 40, clientY: 7 });
    release({ clientX: 40, clientY: 7 });

    expect(rows).toEqual([[rowAt(7), rowAt(7)]]);
    expect(drags).toEqual([]);
  });

  test("a drag reports the rows from its press to its release", () => {
    const { root, rows } = setup("Plain words here.\n");

    press(root, { clientY: 2 });
    move({ clientY: 9 });
    release({ clientY: 9 });

    expect(rows).toEqual([[rowAt(2), rowAt(9)]]);
  });

  test("a drag reports its press row once the pointer leaves that row, and null when it ends", () => {
    const { root, drags } = setup("Plain words here.\n");

    press(root, { clientY: 2 });
    move({ clientY: 2 });
    const onItsRow = [...drags];
    move({ clientY: 5 });
    move({ clientY: 6 });
    const across = [...drags];
    release({ clientY: 6 });

    expect(onItsRow).toEqual([]);
    expect(across).toEqual([rowAt(2)]);
    expect(drags).toEqual([rowAt(2), null]);
  });

  test("a press drops a selection in the preview and holds off native selection until it ends", () => {
    const { root } = setup("Plain words here.\n");
    select(textOf(root, "p"), 0, 5);

    press(root, { clientY: 2 });
    const during = [document.getSelection()?.rangeCount, root.style.userSelect];
    release({ clientY: 2 });

    expect(during).toEqual([0, "none"]);
    expect(root.style.userSelect).toBe("");
  });

  test("a Shift click or drag reports nothing and leaves native selection on", () => {
    const { root, rows, drags } = setup("Plain words here.\n");

    clickAt(root.querySelector("p") as Element, 7, { shiftKey: true });
    press(root, { clientY: 2, shiftKey: true });
    move({ clientY: 9, shiftKey: true });
    const userSelect = root.style.userSelect;
    release({ clientY: 9, shiftKey: true });

    expect(rows.length).toBe(0);
    expect(drags.length).toBe(0);
    expect(userSelect).toBe("");
  });

  test("a click on a file reference opens the file instead", () => {
    const { root, rows, refClicks } = setup(PLAN);

    clickAt(root.querySelector("[data-file-ref]") as Element, 3);

    expect(refClicks()).toBe(1);
    expect(rows.length).toBe(0);
  });

  test("a drag from a file reference reports its rows without opening the file", () => {
    const { root, rows, refClicks } = setup(PLAN);
    const ref = root.querySelector("[data-file-ref]") as Element;

    press(ref, { clientY: 2 });
    move({ clientY: 5 });
    release({ clientY: 5 });
    click(ref);

    expect(rows).toEqual([[rowAt(2), rowAt(5)]]);
    expect(refClicks()).toBe(0);
  });

  test("a click inside a link, button or input reports nothing", () => {
    const { root, rows } = setup("A [link](https://x.test) and - [ ] box.\n\n- [ ] task\n");
    const button = document.createElement("button");
    button.textContent = "go";
    root.querySelector("p")?.append(button);

    for (const el of [root.querySelector("a"), button, root.querySelector("input")] as Element[])
      clickAt(el, 4);

    expect(rows.length).toBe(0);
  });

  test("a press on a wide code block's scrollbar scrolls it and reports nothing", () => {
    const { root, rows } = setup("```ts\nconst x = 1;\n```\n");
    const pre = root.querySelector("pre") as HTMLElement;
    for (const [side, px] of [
      ["clientWidth", 300],
      ["clientHeight", 40],
      ["scrollWidth", 600],
      ["scrollHeight", 40],
    ] as const)
      Object.defineProperty(pre, side, { value: px });
    const down = new PointerEvent("pointerdown", { bubbles: true, button: 0, clientY: 4 });
    Object.defineProperties(down, { offsetX: { value: 10 }, offsetY: { value: 44 } });

    pre.dispatchEvent(down);
    release({ clientY: 4 });

    expect(rows.length).toBe(0);
    expect(pre.closest<HTMLElement>(".plan-preview")?.style.userSelect).toBe("");
  });

  test("a secondary-button click reports nothing", () => {
    const { root, rows } = setup("Plain words here.\n");

    clickAt(root, 4, { button: 2 });

    expect(rows.length).toBe(0);
  });

  for (const [ending, end] of [
    ["pointercancel", () => window.dispatchEvent(new PointerEvent("pointercancel"))],
    ["window blur", () => window.dispatchEvent(new Event("blur"))],
  ] as const) {
    test(`a gesture ended by ${ending} ends its drag and reports no later release`, () => {
      const { root, rows, drags } = setup("Plain words here.\n");
      press(root, { clientY: 2 });
      move({ clientY: 5 });
      end();

      release({ clientY: 7 });

      expect(drags).toEqual([rowAt(2), null]);
      expect(rows.length).toBe(0);
      expect(root.style.userSelect).toBe("");
    });
  }

  test("two presses before one release report once", () => {
    const { root, rows } = setup("Plain words here.\n");
    press(root, { clientY: 2 });

    press(root, { clientY: 4 });
    release({ clientY: 4 });

    expect(rows).toEqual([[rowAt(4), rowAt(4)]]);
  });

  test("a release after unmount reports nothing", () => {
    const rows: [TextPoint, TextPoint][] = [];
    const drags: (TextPoint | null)[] = [];
    const target = document.createElement("div");
    document.body.append(target);
    const instance = mount(PlanPreview, {
      target,
      props: {
        html: renderPlanMarkdown("Plain words here.\n").html,
        rowAt,
        onTextComment: (from: TextPoint, to: TextPoint) => rows.push([from, to]),
        onCommentDrag: (anchor: TextPoint | null) => drags.push(anchor),
      },
    });
    flushSync();
    const root = target.querySelector(".plan-preview") as HTMLElement;
    press(root, { clientY: 2 });
    move({ clientY: 5 });
    unmount(instance);
    target.remove();

    release({ clientY: 5 });

    expect(drags).toEqual([rowAt(2), null]);
    expect(rows.length).toBe(0);
  });

  test("a Shift press clears a selection anchored outside the preview", () => {
    const { root } = setup("Plain words here.\n");
    select(outsideText(), 2);

    press(root, { shiftKey: true });

    expect(document.getSelection()?.rangeCount).toBe(0);
  });

  test("a Shift press keeps a selection anchored inside the preview", () => {
    const { root } = setup("Plain words here.\n");
    const kept = select(textOf(root, "p"), 2);

    press(root, { shiftKey: true });

    expect(document.getSelection()?.getRangeAt(0) === kept).toBe(true);
  });
});
