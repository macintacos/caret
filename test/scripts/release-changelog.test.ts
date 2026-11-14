import { expect, test } from "bun:test";

import { renderChangelog } from "@/tasks/release/changelog.ts";

const release = (tag: string, notes = "### Added\n\n- A thing.\n", publishedAt = "2026-11-12") => ({
  tag,
  publishedAt: new Date(`${publishedAt}T12:00:00Z`),
  notes,
});

/** The lines from `## <tag>` up to the next `## ` heading. */
function section(page: string, tag: string): string {
  return page.split(`\n## ${tag}\n`)[1]?.split("\n## ")[0] ?? "";
}

test("lists releases newest first by version, not by string order", () => {
  const page = renderChangelog("o/r", [release("v0.9.0"), release("v0.10.0")]);
  expect(page.indexOf("## v0.10.0")).toBeGreaterThan(-1);
  expect(page.indexOf("## v0.10.0")).toBeLessThan(page.indexOf("## v0.9.0"));
});

test("gives each release its date and a link to its GitHub release", () => {
  const page = renderChangelog("o/r", [release("v1.2.0", undefined, "2026-10-07")]);
  expect(section(page, "v1.2.0")).toContain("2026-10-07");
  expect(section(page, "v1.2.0")).toContain("(https://github.com/o/r/releases/tag/v1.2.0)");
});

test("dates a release by its UTC day, whatever the machine's time zone", () => {
  const late = { tag: "v1.0.0", publishedAt: new Date("2026-11-13T03:00:00Z"), notes: "" };
  expect(section(renderChangelog("o/r", [late]), "v1.0.0")).toContain("2026-11-13");
});

test("demotes a release's headings to sit under its version heading", () => {
  const page = renderChangelog("o/r", [release("v1.0.0", "# Big\n\nText.\n\n## Detail\n")]);
  expect(section(page, "v1.0.0")).toContain("\n### Big\n");
  expect(section(page, "v1.0.0")).toContain("\n#### Detail\n");
});

test("keeps notes already headed at level 3 as they are", () => {
  const page = renderChangelog("o/r", [release("v1.0.0", "### Added\n\n#### Detail\n")]);
  expect(section(page, "v1.0.0")).toContain("\n### Added\n\n#### Detail\n");
});

test("leaves heading-like lines inside fenced code alone", () => {
  const notes = "## Changed\n\n```sh\n# a shell comment\n```\n\n~~~md\n## literal\n~~~\n";
  const page = renderChangelog("o/r", [release("v1.0.0", notes)]);
  expect(section(page, "v1.0.0")).toContain("\n### Changed\n");
  expect(page).toContain("\n# a shell comment\n");
  expect(page).toContain("\n## literal\n");
});

test("nests a block under a list item at the 4 spaces the site's renderer needs", () => {
  const notes = "- Commands:\n\n  | A | B |\n  | --- | --- |\n\n- Next,\n  wrapped.\n";
  const page = renderChangelog("o/r", [release("v1.0.0", notes)]);
  expect(section(page, "v1.0.0")).toContain("\n    | A | B |\n    | --- | --- |\n");
  expect(section(page, "v1.0.0")).toContain("\n- Next,\n    wrapped.");
});

test("leaves indented lines outside a list, and inside fenced code, where they are", () => {
  const notes = "- Item.\n\n### Fixed\n\n  Indented text.\n\n```md\n- a\n  b\n```\n";
  const page = renderChangelog("o/r", [release("v1.0.0", notes)]);
  expect(section(page, "v1.0.0")).toContain("\n  Indented text.\n");
  expect(section(page, "v1.0.0")).toContain("\n- a\n  b\n```");
});
