import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import { render } from "@ui/support/mount.ts";
import { reactiveProps } from "@ui/support/props.svelte.ts";
import PlanPreview from "@/components/PlanPreview.svelte";
import { renderPlanMarkdown } from "$lib/planMarkdown.ts";

function task(target: HTMLElement, selector: string): HTMLInputElement {
  return target.querySelector(selector) as HTMLInputElement;
}

describe("PlanPreview", () => {
  test("marks a slashed task's checkbox indeterminate", () => {
    const { target, flush } = render(PlanPreview, {
      html: renderPlanMarkdown("- [/] half\n- [x] done\n").html,
    });
    flush();

    expect(task(target, 'input[data-task="slashed"]').indeterminate).toBe(true);
    expect(task(target, "input:checked").indeterminate).toBe(false);
  });

  test("marks a slashed task that arrives with new html", () => {
    const props = reactiveProps({ html: renderPlanMarkdown("plain\n").html });
    const { target, flush } = render(PlanPreview, props);
    flush();

    props.html = renderPlanMarkdown("- [/] later\n").html;
    flush();

    expect(task(target, 'input[data-task="slashed"]').indeterminate).toBe(true);
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
});
