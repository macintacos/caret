// Fold the reviewer's notes and queued comments into the plan the agent works from
// (EXC-791). An approval carries an optional note and any line-cited comments; caret
// appends them as a clearly labeled section at the end of the plan so the agent picks
// them up as it proceeds, without another planning round. Browser-safe (no node
// imports) so the same wording can be reused wherever a plan is rendered.

/** The heading that marks the appended notes as reviewer-provided, so the agent
 * never mistakes them for part of the original plan. */
const NOTES_HEADING = "## Notes from the user";

/** Opens the notes section when comments ride the approval, so the agent applies
 * them while implementing instead of planning again. */
const COMMENTS_INSTRUCTION =
  "The user approved this plan with these comments. Fold them in as you implement, without another planning round.";

/**
 * The notes section's body: the instruction line when `comments` is non-blank, then
 * the typed notes, then the comments. A blank part leaves no gap, so notes alone pass
 * through trimmed and their section is unchanged.
 */
export function reviewerNotesBody(notes: string, comments: string): string {
  const cited = comments.trim();
  return [cited ? COMMENTS_INSTRUCTION : "", notes.trim(), cited].filter(Boolean).join("\n\n");
}

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
