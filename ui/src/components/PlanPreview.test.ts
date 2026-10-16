import "@ui/support/mount.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { until } from "@test/support/poll.ts";
import { render } from "@ui/support/mount.ts";
import { reactiveProps } from "@ui/support/props.svelte.ts";
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

describe("PlanPreview file references", () => {
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

  test("a click on plain text opens nothing", () => {
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
