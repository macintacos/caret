import { describe, expect, test } from "bun:test";

import { hyperlink } from "@earendil-works/pi-tui";
import { callLine, type PiTheme, planTitle, resultLine } from "@piext/render.ts";

const theme: PiTheme = { fg: (color, text) => `<${color}>${text}</${color}>` };

describe("planTitle", () => {
  test("takes the plan's first # heading", () => {
    expect(planTitle({ plan: "intro\n# Add retries\n## Steps" })).toBe("Add retries");
  });

  test("falls back to the path's basename", () => {
    expect(planTitle({ path: "docs/plans/retry.md" })).toBe("retry.md");
  });

  test("falls back to plan with neither a heading nor a path", () => {
    expect(planTitle({})).toBe("plan");
    expect(planTitle({ plan: "no heading\n## sub" })).toBe("plan");
  });
});

test("callLine names caret and the plan title", () => {
  expect(callLine({ plan: "# Add retries" }, theme)).toBe(
    "<toolTitle>caret</toolTitle> <muted>Add retries</muted>",
  );
});

describe("resultLine", () => {
  test("a waiting review shows the link", () => {
    const line = resultLine({ state: "waiting", url: "http://x/r/1" }, theme);
    expect(line).toContain("<warning>^</warning>");
    expect(line).toContain("<muted>waiting for review</muted>");
    expect(line).toContain(`<dim>${hyperlink("http://x/r/1", "http://x/r/1")}</dim>`);
  });

  test.each([
    ["approved", "<success>✓ approved</success>"],
    ["changes", "<warning>↺ changes requested</warning>"],
    ["cancelled", "<muted>cancelled</muted>"],
    ["failed", "<error>✕ review failed</error>"],
  ] as const)("a settled %s review", (state, expected) => {
    expect(resultLine({ state }, theme)).toBe(expected);
  });
});
