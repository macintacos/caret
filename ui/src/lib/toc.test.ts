import { describe, expect, test } from "bun:test";

import {
  activeHeadingLine,
  extractHeadings,
  filterHeadings,
  lineForSlug,
  slugForLine,
  type TocHeading,
} from "$lib/toc.ts";

describe("extractHeadings", () => {
  test("collects ATX headings with their level, text, and 1-based line", () => {
    const src = "# Title\n\nIntro paragraph.\n\n## Section\n\nbody\n\n### Sub\n";
    expect(extractHeadings(src)).toEqual([
      { level: 1, text: "Title", line: 1 },
      { level: 2, text: "Section", line: 5 },
      { level: 3, text: "Sub", line: 9 },
    ]);
  });

  test("recognizes all six ATX levels", () => {
    const src = "# h1\n## h2\n### h3\n#### h4\n##### h5\n###### h6\n";
    expect(extractHeadings(src).map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("ignores a seven-hash line (not a valid ATX heading)", () => {
    expect(extractHeadings("####### too many\n")).toEqual([]);
  });

  test("requires whitespace after the hashes", () => {
    // "#nospace" is not a heading; "# spaced" is.
    expect(extractHeadings("#nospace\n# spaced\n")).toEqual([
      { level: 1, text: "spaced", line: 2 },
    ]);
  });

  test("strips trailing closing hashes", () => {
    expect(extractHeadings("## Section ##\n")).toEqual([{ level: 2, text: "Section", line: 1 }]);
  });

  test("ignores hash lines inside a fenced code block", () => {
    const src = "# Real\n\n```\n# not a heading\n## also not\n```\n\n## After\n";
    expect(extractHeadings(src)).toEqual([
      { level: 1, text: "Real", line: 1 },
      { level: 2, text: "After", line: 8 },
    ]);
  });

  test("ignores hash lines inside a tilde-fenced code block", () => {
    const src = "# Real\n~~~\n# not a heading\n~~~\n## After\n";
    expect(extractHeadings(src)).toEqual([
      { level: 1, text: "Real", line: 1 },
      { level: 2, text: "After", line: 5 },
    ]);
  });

  test("ignores hashes under an unterminated fence to the end of input", () => {
    const src = "# Real\n\n```\n# trapped\n## still trapped\n";
    expect(extractHeadings(src)).toEqual([{ level: 1, text: "Real", line: 1 }]);
  });

  test("allows indented headings (leading spaces before the hash)", () => {
    expect(extractHeadings("   ## Indented\n")).toEqual([{ level: 2, text: "Indented", line: 1 }]);
  });

  test("returns an empty list for text with no headings", () => {
    expect(extractHeadings("just some prose\n\nmore prose\n")).toEqual([]);
    expect(extractHeadings("")).toEqual([]);
  });
});

describe("activeHeadingLine", () => {
  const headings: TocHeading[] = [
    { level: 1, text: "A", line: 1 },
    { level: 2, text: "B", line: 10 },
    { level: 2, text: "C", line: 20 },
  ];

  test("returns null when there are no headings", () => {
    expect(activeHeadingLine([], 5)).toBeNull();
  });

  test("returns the first heading at the top of the document", () => {
    expect(activeHeadingLine(headings, 1)).toBe(1);
  });

  test("returns the first heading when scrolled above it", () => {
    // topLine before the first heading still anchors to the first heading.
    expect(activeHeadingLine(headings, 0)).toBe(1);
  });

  test("returns the heading exactly at the top line", () => {
    expect(activeHeadingLine(headings, 10)).toBe(10);
  });

  test("returns the last heading at or above the top line", () => {
    expect(activeHeadingLine(headings, 15)).toBe(10);
    expect(activeHeadingLine(headings, 25)).toBe(20);
  });
});

describe("filterHeadings", () => {
  const headings: TocHeading[] = [
    { level: 1, text: "Context", line: 1 },
    { level: 2, text: "Approach", line: 5 },
    { level: 2, text: "Verification", line: 9 },
  ];

  test("returns all headings for an empty query", () => {
    expect(filterHeadings(headings, "")).toEqual(headings);
    expect(filterHeadings(headings, "   ")).toEqual(headings);
  });

  test("matches a case-insensitive substring of the text", () => {
    expect(filterHeadings(headings, "app")).toEqual([{ level: 2, text: "Approach", line: 5 }]);
    expect(filterHeadings(headings, "ION")).toEqual([{ level: 2, text: "Verification", line: 9 }]);
  });

  test("returns an empty list when nothing matches", () => {
    expect(filterHeadings(headings, "zzz")).toEqual([]);
  });
});

describe("header slugs", () => {
  test("slugForLine derives a readable slug from the heading text", () => {
    const headings = extractHeadings("# Tables\n## Code blocks\n");
    expect(slugForLine(headings, 1)).toBe("tables");
    expect(slugForLine(headings, 2)).toBe("code-blocks");
  });

  test("de-duplicates repeated heading text with a numeric suffix", () => {
    const headings = extractHeadings("# Revision\n# Revision\n# Revision\n");
    expect(slugForLine(headings, 1)).toBe("revision");
    expect(slugForLine(headings, 2)).toBe("revision-1");
    expect(slugForLine(headings, 3)).toBe("revision-2");
  });

  test("collapses punctuation and falls back for symbol-only headings", () => {
    const headings = extractHeadings("# Overflow & edge cases\n# ---\n# !!!\n");
    expect(slugForLine(headings, 1)).toBe("overflow-edge-cases");
    expect(slugForLine(headings, 2)).toBe("section");
    expect(slugForLine(headings, 3)).toBe("section-1");
  });

  test("lineForSlug round-trips with slugForLine", () => {
    const headings = extractHeadings("# Tables\n## Code blocks\n# Tables\n");
    for (const h of headings) {
      const slug = slugForLine(headings, h.line);
      expect(slug).not.toBeNull();
      expect(lineForSlug(headings, slug as string)).toBe(h.line);
    }
  });

  test("returns null for an unknown line or slug", () => {
    const headings = extractHeadings("# Tables\n## Code blocks\n");
    expect(slugForLine(headings, 999)).toBeNull();
    expect(lineForSlug(headings, "does-not-exist")).toBeNull();
  });
});
