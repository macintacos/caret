// Fold reviewer notes into the plan the agent works from (EXC-791). On an
// approval the reviewer may add an optional note; caret appends it as a clearly
// labeled section at the end of the plan so the agent picks it up as it proceeds,
// without another planning round. Browser-safe (no node imports) so the same
// wording can be reused wherever a plan is rendered.

/** The heading that marks the appended notes as reviewer-provided, so the agent
 * never mistakes them for part of the original plan. */
const NOTES_HEADING = "## Notes from the user";

/**
 * The trailing notes section to append to a plan, or "" when the note is blank.
 * A horizontal rule separates it from the plan body; the note is trimmed.
 */
export function reviewerNotesSection(notes: string): string {
  const trimmed = notes.trim();
  if (trimmed === "") return "";
  return `\n\n---\n\n${NOTES_HEADING}\n\n${trimmed}\n`;
}

/** The plan with the reviewer's notes appended, or the plan unchanged when the
 * note is blank. */
export function appendReviewerNotes(plan: string, notes: string): string {
  return plan + reviewerNotesSection(notes);
}
