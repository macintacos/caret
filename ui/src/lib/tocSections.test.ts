import { describe, expect, test } from "bun:test";

import type { CommentIndexEntry } from "$lib/feedback.ts";
import { extractHeadings } from "$lib/toc.ts";
import { describeSection, sectionDeltas, tocSections } from "$lib/tocSections.ts";

// Line numbers matter to every assertion here, so the plan is spelled one line per
// array entry with its 1-based number alongside.
const PLAN = [
  "# Plan", //                          1
  "", //                                2
  "The **whole** plan, in `brief`.", // 3
  "", //                                4
  "## Intake", //                       5
  "", //                                6
  "Read frames from the [socket](https://example.com).", // 7
  "Drop malformed ones.", //            8
  "", //                                9
  "### Decode", //                     10
  "", //                               11
  "Parse each frame.", //              12
  "", //                               13
  "## Retention", //                   14
  "", //                               15
  "Keep a week.", //                   16
  "", //                               17
].join("\n");

const HEADINGS = extractHeadings(PLAN);

function comment(line: number, text: string, draft = false): CommentIndexEntry {
  return {
    id: `${draft ? "s" : "a"}${line}`,
    line,
    label: `Line ${line}`,
    text,
    draft,
    linkable: true,
  };
}

function section(line: number, comments: CommentIndexEntry[] = [], previous: string | null = null) {
  const found = tocSections(HEADINGS, PLAN, comments, previous).get(line);
  if (found === undefined) throw new Error(`no section at line ${line}`);
  return found;
}

describe("tocSections comments", () => {
  test("buckets each comment into the section whose own lines hold it", () => {
    const comments = [comment(7, "intake"), comment(12, "decode"), comment(16, "retention")];
    expect(section(5, comments).comments.map((c) => c.text)).toEqual(["intake"]);
    expect(section(10, comments).comments.map((c) => c.text)).toEqual(["decode"]);
    expect(section(14, comments).comments.map((c) => c.text)).toEqual(["retention"]);
  });

  test("keeps drafts beside comments, flagged as drafts", () => {
    const comments = [comment(7, "sent"), comment(8, "unsent", true)];
    expect(section(5, comments).comments.map((c) => c.draft)).toEqual([false, true]);
  });
});

describe("tocSections change since the previous version", () => {
  test("is null for every section when there is no previous version", () => {
    expect(section(5).change).toBeNull();
  });

  test("is null for a section whose own text is unchanged", () => {
    expect(section(5, [], PLAN).change).toBeNull();
  });

  test("marks a section edited when its own text differs from the same heading's", () => {
    const previous = PLAN.replace("Drop malformed ones.", "Keep malformed ones.");
    expect(section(5, [], previous).change).toBe("edited");
  });

  test("leaves the parent alone when only a subsection changed", () => {
    const previous = PLAN.replace("Parse each frame.", "Parse frames lazily.");
    expect(section(10, [], previous).change).toBe("edited");
    expect(section(5, [], previous).change).toBeNull();
  });

  test("marks a heading the previous version did not have as new", () => {
    const previous = PLAN.replace("### Decode", "### Parse");
    expect(section(10, [], previous).change).toBe("new");
  });

  test("pairs two same-titled headings with their counterparts in order", () => {
    const plan = "# Plan\n## Notes\nFirst.\n## Notes\nSecond.\n";
    const previous = "# Plan\n## Notes\nFirst.\n## Notes\nChanged.\n";
    const sections = tocSections(extractHeadings(plan), plan, [], previous);
    expect(sections.get(2)?.change).toBeNull();
    expect(sections.get(4)?.change).toBe("edited");
  });
});

describe("describeSection", () => {
  test("says nothing for a section with no comments and no change", () => {
    expect(describeSection(section(5), 3)).toBe("");
  });

  test("names the comments, the unsent ones and the change, in that order", () => {
    const comments = [comment(7, "a"), comment(8, "b"), comment(8, "c", true)];
    const previous = PLAN.replace("Drop malformed ones.", "Keep malformed ones.");
    expect(describeSection(section(5, comments, previous), 3)).toBe(
      "2 comments, 1 unsent, edited since v3",
    );
  });

  test("uses the singular for one comment", () => {
    expect(describeSection(section(5, [comment(7, "a")]), null)).toBe("1 comment");
  });
});

// Compare mode: what each of the base version's sections gained or lost against the
// target version, and the line the outline jumps to. The base is PLAN; each target below
// is PLAN with one kind of change.
describe("sectionDeltas", () => {
  const without = (...drop: number[]) =>
    PLAN.split("\n")
      .filter((_, i) => !drop.includes(i + 1))
      .join("\n");

  test("counts the lines a section gained, and jumps to the first of them", () => {
    // The target lacks lines 7 and 8, so Intake gained both in the base.
    const deltas = sectionDeltas(HEADINGS, PLAN, without(7, 8));
    expect([...deltas.entries()]).toEqual([[5, { added: 2, removed: 0, line: 7, side: "after" }]]);
  });

  test("counts an edited line as one gained and one lost", () => {
    const target = PLAN.replace("Keep a week.", "Keep a day.");
    expect(sectionDeltas(HEADINGS, PLAN, target).get(14)).toEqual({
      added: 1,
      removed: 1,
      line: 16,
      side: "after",
    });
  });

  test("jumps a section that only lost lines to the first lost line in the target", () => {
    const target = PLAN.replace("Parse each frame.", "Parse each frame.\nLog the bad ones.");
    expect(sectionDeltas(HEADINGS, PLAN, target).get(10)).toEqual({
      added: 0,
      removed: 1,
      line: 13,
      side: "before",
    });
  });

  test("counts a section the target lacks as wholly gained, its heading included", () => {
    // Retention (lines 14–17) is absent from the target.
    expect(sectionDeltas(HEADINGS, PLAN, without(14, 15, 16, 17)).get(14)).toEqual({
      added: 4,
      removed: 0,
      line: 14,
      side: "after",
    });
  });

  test("leaves out every section whose own lines match", () => {
    expect(sectionDeltas(HEADINGS, PLAN, PLAN).size).toBe(0);
  });
});
