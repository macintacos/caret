import { expect, test } from "bun:test";

import {
  appendReviewerNotes,
  reviewerNotesBody,
  reviewerNotesSection,
} from "@/plan/reviewer-notes.ts";

// Reviewer notes on an approval are appended to the plan the agent works from,
// as a clearly-labeled trailing section, so the agent folds them into its work
// without another planning round (EXC-791).

test("reviewerNotesSection wraps a note in a labeled, rule-separated section", () => {
  const section = reviewerNotesSection("use the existing retry helper");
  // Separated from the plan body by a horizontal rule, and clearly marked as
  // reviewer-provided so the agent never mistakes it for the original plan.
  expect(section.startsWith("\n\n---\n\n")).toBe(true);
  expect(section).toContain("## Notes from the user");
  expect(section).toContain("use the existing retry helper");
});

test("reviewerNotesSection produces nothing for a blank note", () => {
  expect(reviewerNotesSection("")).toBe("");
  expect(reviewerNotesSection("   \n  ")).toBe("");
});

test("reviewerNotesSection trims the note", () => {
  const section = reviewerNotesSection("  hello  ");
  expect(section).toContain("\n\nhello\n");
  expect(section).not.toContain("  hello  ");
});

test("appendReviewerNotes appends the section to the plan", () => {
  const plan = "# Plan\n\nDo the thing.\n";
  const out = appendReviewerNotes(plan, "and also this");
  expect(out.startsWith(plan)).toBe(true);
  expect(out).toContain("## Notes from the user");
  expect(out).toContain("and also this");
});

test("appendReviewerNotes returns the plan unchanged for a blank note", () => {
  const plan = "# Plan\n\nDo the thing.\n";
  expect(appendReviewerNotes(plan, "")).toBe(plan);
  expect(appendReviewerNotes(plan, "   ")).toBe(plan);
});

const paragraphs = (body: string) => body.split("\n\n");

test("reviewerNotesBody passes notes alone through trimmed, leaving their section unchanged", () => {
  expect(reviewerNotesBody("  n  ", "")).toBe("n");
  expect(reviewerNotesSection(reviewerNotesBody("n", ""))).toBe(reviewerNotesSection("n"));
});

test("reviewerNotesBody opens comments with an instruction paragraph", () => {
  const body = paragraphs(reviewerNotesBody("", "1. Line 2: fix"));
  expect(body).toHaveLength(2);
  expect(body[1]).toBe("1. Line 2: fix");
});

test("reviewerNotesBody orders the instruction, the notes, then the comments", () => {
  const [instruction] = paragraphs(reviewerNotesBody("", "c"));
  expect(paragraphs(reviewerNotesBody("n", "c"))).toEqual([instruction ?? "", "n", "c"]);
});

test("reviewerNotesBody is empty when both parts are blank", () => {
  expect(reviewerNotesBody("  ", " ")).toBe("");
  expect(reviewerNotesSection(reviewerNotesBody("", ""))).toBe("");
});
