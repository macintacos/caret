// Deterministic feedback formatting. The result is sent verbatim as the
// `deny.message` the model reads when changes are requested, so the shape must
// be stable and readable: an optional general comment, then a numbered list of
// inline comments. Both shapes cite an abbreviated quote — the selection's first
// and last few words around an ellipsis — so the agent can locate the feedback by
// content without the full selection's token cost. A legacy annotation cites it
// inline; a line-anchored annotation pairs it with the annotation's 1-based line
// reference into the stored plan version, so the agent can find the feedback even
// when its own line numbering differs.

import { type Annotation, isLegacyAnnotation, isLineAnnotation } from "@core/types";

/** Collapses any run of whitespace (incl. newlines) to a single space. */
function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The "Line N" / "Lines N-M" header for a line-anchored annotation. */
function lineHeader(startLine: number, endLine: number): string {
  return startLine === endLine ? `Line ${startLine}:` : `Lines ${startLine}-${endLine}:`;
}

/** The source lines a line-anchored annotation spans, sliced 1-based and
 * inclusive from the plan text. Returns [] when the range falls past the end of
 * the text (a stale anchor), so the entry degrades to its reference with no
 * quote block rather than throwing. */
function quotedLines(startLine: number, endLine: number, planLines: string[]): string[] {
  return planLines.slice(startLine - 1, endLine);
}

const QUOTE_HEAD_WORDS = 3;
const QUOTE_TAIL_WORDS = 3;

/** Abbreviates a quote to the line reference's companion: the first and last few
 * words joined by an ellipsis, dropping the middle. The agent locates the text by
 * its line numbers and confirms it by these anchor words; the elided middle is
 * wasted tokens, since the agent re-reads the plan itself. A quote short enough
 * that abbreviation would drop no words is returned whole (whitespace collapsed). */
function abbreviate(text: string): string {
  const flat = flatten(text);
  const words = flat.split(" ");
  if (words.length <= QUOTE_HEAD_WORDS + QUOTE_TAIL_WORDS) return flat;
  const head = words.slice(0, QUOTE_HEAD_WORDS).join(" ");
  const tail = words.slice(-QUOTE_TAIL_WORDS).join(" ");
  return `${head} … ${tail}`;
}

/** Renders one annotation (comment already trimmed and non-blank) as a numbered
 * entry. Legacy annotations stay on one line; line-anchored ones span a header,
 * a single abbreviated quote line, and the comment, each continuation line
 * indented under the number. The quote line is omitted when the range is a stale
 * anchor with nothing to quote. */
function entry(a: Annotation, n: number, planLines: string[]): string {
  if (isLegacyAnnotation(a)) {
    return `${n}. On "${abbreviate(a.quote)}": ${a.comment.trim()}`;
  }
  const lines = [`${n}. ${lineHeader(a.startLine, a.endLine)}`];
  const quote = abbreviate(quotedLines(a.startLine, a.endLine, planLines).join(" "));
  if (quote) lines.push(`   > ${quote}`);
  lines.push(`   ${a.comment.trim()}`);
  return lines.join("\n");
}

/** The annotations that carry a non-blank comment — the inline feedback that
 * actually reaches the agent. The one predicate every surface counts pending
 * inline comments by, so the approve guard, the request-changes summary, and the
 * formatted feedback never disagree about which comments are "pending". */
export function pendingInline(annotations: Annotation[]): Annotation[] {
  return annotations.filter((a) => a.comment.trim().length > 0);
}

/** How many inline comments are pending (non-blank), for the surfaces that show
 * the count without formatting the feedback. */
export function pendingInlineCount(annotations: Annotation[]): number {
  return pendingInline(annotations).length;
}

/** How many distinct source locations the pending inline comments anchor to. A
 * line-anchored annotation's location is its `startLine-endLine` span, so several
 * comments on the same line (or the same range) collapse to one location; a
 * legacy annotation has no line anchor, so each counts as its own location. Lets
 * the dialog say "N comments on M lines" honestly — M < N only when comments
 * share a location. */
export function pendingLineCount(annotations: Annotation[]): number {
  const locations = new Set<string>();
  pendingInline(annotations).forEach((a, i) => {
    locations.add(isLineAnnotation(a) ? `line:${a.startLine}-${a.endLine}` : `legacy:${i}`);
  });
  return locations.size;
}

/** How many distinct source lines the pending line-anchored comments cover — the
 * size of the UNION of their `[startLine, endLine]` ranges, so a line touched by
 * two overlapping comments counts once (not the sum of range lengths). Only
 * line-anchored annotations have a source-line anchor; legacy (selection-anchored)
 * annotations carry no line range and so contribute to the comment count but not
 * to coverage. */
export function coveredLineCount(annotations: Annotation[]): number {
  const covered = new Set<number>();
  for (const a of pendingInline(annotations)) {
    if (!isLineAnnotation(a)) continue;
    for (let line = a.startLine; line <= a.endLine; line++) covered.add(line);
  }
  return covered.size;
}

/**
 * Formats annotations + a general comment into a single feedback string.
 * `planText` is the stored plan version the annotations anchor into, used to
 * quote a line-anchored annotation's source lines. Annotations with blank
 * comments are skipped; numbering follows array order. Returns "" when there is
 * nothing to say.
 */
export function formatFeedback(
  annotations: Annotation[],
  generalComment: string,
  planText: string,
): string {
  const general = generalComment.trim();
  const planLines = planText.split("\n");

  const inline = pendingInline(annotations);

  const sections: string[] = [];
  if (general) sections.push(general);

  if (inline.length > 0) {
    const entries = inline.map((a, i) => entry(a, i + 1, planLines));
    sections.push(["Inline comments:", "", ...entries].join("\n"));
  }

  return sections.join("\n\n");
}
