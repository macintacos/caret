import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import { render } from "@ui/support/mount.ts";
import { reactiveProps } from "@ui/support/props.svelte.ts";
import PlanPreview from "@/components/PlanPreview.svelte";
import { renderPlanMarkdown } from "$lib/planMarkdown.ts";
import type { ThemeId } from "$lib/theme.ts";

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

    await until(() => code.children.length > 0);

    expect(code.textContent).toBe(text);
    expect(colours(code).size).toBeGreaterThan(1);
  });

  test("leaves an unknown-language block and a bare block as one text node", async () => {
    const plan = renderPlanMarkdown("```nosuchlang\nconst x = 1;\n```\n\n```\nconst y = 2;\n```\n");
    const { target, flush } = render(PlanPreview, {
      html: plan.html,
      codeLanguages: plan.codeLanguages,
      themeId: "caret-dark",
    });
    flush();
    await settle();

    for (const code of target.querySelectorAll("pre code"))
      expect([...code.childNodes].map((n) => n.nodeType)).toEqual([Node.TEXT_NODE]);
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
    await until(() => code.children.length > 0);
    const dark = [...colours(code)];

    props.themeId = "caret-light";
    flush();

    await until(() => [...colours(code)].join() !== dark.join());
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

function codeOf(target: HTMLElement): HTMLElement {
  return target.querySelector("pre code") as HTMLElement;
}

function colours(code: Element): Set<string> {
  return new Set(
    [...code.querySelectorAll<HTMLElement>("[style]")].map((span) => span.style.color),
  );
}

// Bun runs every due timer before draining microtasks, so each step pairs a timer
// with a microtask flush to let the pass's own continuations run.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !done(); i++) await settle();
  expect(done()).toBe(true);
}
