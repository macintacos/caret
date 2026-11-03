// The fixtures the `assets` task (EXC-805) stages its hero on. It resolves them
// against scripts/tasks/dev/demo-plan.md at run time, in a browser, outside every
// gate — so an edit that strands one is only caught here. preflight's
// MARKDOWN_READ_BY_TESTS is what makes that true for a Markdown-only change, which
// would otherwise narrow the gate to `lint` alone.
//
// test/scripts/ mirrors scripts/ (doc/agents/test-layout.md).

import { expect, test } from "bun:test";

import { MARKDOWN_READ_BY_TESTS } from "@scripts/preflight.ts";
import { ANNOTATIONS, PREVIEW_FILE } from "@/tasks/assets.ts";

const DEMO_PLAN = await Bun.file(`${import.meta.dir}/../../scripts/tasks/dev/demo-plan.md`).text();

test("each comment anchors on exactly one line of the demo plan", () => {
  expect(ANNOTATIONS).toHaveLength(2);
  for (const { anchor } of ANNOTATIONS) {
    expect(DEMO_PLAN.split("\n").filter((line) => line.includes(anchor))).toHaveLength(1);
  }
});

test("the demo plan cites the file the hero previews, as a code span", () => {
  expect(DEMO_PLAN).toContain(`\`${PREVIEW_FILE.ref}\``);
  expect(PREVIEW_FILE.ref.startsWith(PREVIEW_FILE.path)).toBe(true);
});

test("preflight runs this suite when only the demo plan changed", () => {
  expect(MARKDOWN_READ_BY_TESTS).toContain("scripts/tasks/dev/demo-plan.md");
});
