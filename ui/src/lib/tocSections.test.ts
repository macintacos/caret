import { describe, expect, test } from "bun:test";

import type { CommentIndexEntry } from "$lib/feedback.ts";
import { extractHeadings } from "$lib/toc.ts";
import { describeSection, tocSections } from "$lib/tocSections.ts";

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

describe("tocSections ranges", () => {
  test("a section runs to its last non-blank line before the next heading at its level or above", () => {
    expect(section(5).end).toBe(12);
    expect(section(10).end).toBe(12);
  });

  test("the outermost section runs to the plan's last non-blank line", () => {
    expect(section(1).end).toBe(16);
    expect(section(14).end).toBe(16);
  });
});

describe("tocSections excerpt", () => {
  test("is the section's own opening lines as plain text, up to its first subsection", () => {
    expect(section(5).excerpt).toBe("Read frames from the socket. Drop malformed ones.");
    expect(section(1).excerpt).toBe("The whole plan, in brief.");
  });

  test("skips fenced code, which is not prose", () => {
    const plan = "# Plan\n\n```ts\nconst x = 1;\n```\n\nAfter the fence.\n";
    const sections = tocSections(extractHeadings(plan), plan, [], null);
    expect(sections.get(1)?.excerpt).toBe("After the fence.");
  });

  test("is empty for a heading with no prose of its own", () => {
    const plan = "# Plan\n## Child\n\nBody.\n";
    expect(tocSections(extractHeadings(plan), plan, [], null).get(1)?.excerpt).toBe("");
  });
});

describe("tocSections comments", () => {
  test("buckets each comment into the section whose own lines hold it", () => {
    const comments = [comment(7, "intake"), comment(12, "decode"), comment(16, "retention")];
    expect(section(5, comments).comments.map((c) => c.text)).toEqual(["intake"]);
    expect(section(10, comments).comments.map((c) => c.text)).toEqual(["decode"]);
    expect(section(14, comments).comments.map((c) => c.text)).toEqual(["retention"]);
  });

  test("counts the comments in a section's subsections apart from its own", () => {
    const comments = [comment(7, "intake"), comment(12, "decode", true)];
    expect(section(5, comments).deeper).toBe(1);
    expect(section(1, comments).deeper).toBe(2);
    expect(section(10, comments).deeper).toBe(0);
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

  test("names the comments, the drafts and the change, in that order", () => {
    const comments = [comment(7, "a"), comment(8, "b"), comment(8, "c", true)];
    const previous = PLAN.replace("Drop malformed ones.", "Keep malformed ones.");
    expect(describeSection(section(5, comments, previous), 3)).toBe(
      "2 comments, 1 draft, edited since v3",
    );
  });

  test("uses the singular for one comment", () => {
    expect(describeSection(section(5, [comment(7, "a")]), null)).toBe("1 comment");
  });
});
