import { expect, test } from "bun:test";
import { appendReviewerNotes, reviewerNotesSection } from "../../src/plan/reviewer-notes.ts";

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
