// Deterministic feedback formatting. The result is sent verbatim as the
// `deny.message` the model reads when changes are requested, so the shape must
// be stable and readable: an optional general comment, then a numbered list of
// inline comments. A legacy annotation cites its quoted selection inline; a
// line-anchored annotation cites its 1-based line reference and quotes the
// source lines from the stored plan version, so the agent can locate the
// feedback by content even when its own line numbering differs.

import { type Annotation, isLegacyAnnotation } from "@core/types";

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

/** Renders one annotation (comment already trimmed and non-blank) as a numbered
 * entry. Legacy annotations stay on one line; line-anchored ones span a header,
 * a quoted block, and the comment, each continuation line indented under the
 * number. */
function entry(a: Annotation, n: number, planLines: string[]): string {
  if (isLegacyAnnotation(a)) {
    return `${n}. On "${flatten(a.quote)}": ${a.comment.trim()}`;
  }
  const lines = [`${n}. ${lineHeader(a.startLine, a.endLine)}`];
  for (const quoted of quotedLines(a.startLine, a.endLine, planLines)) {
    lines.push(`   > ${quoted}`);
  }
  lines.push(`   ${a.comment.trim()}`);
  return lines.join("\n");
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

  const inline = annotations.filter((a) => a.comment.trim().length > 0);

  const sections: string[] = [];
  if (general) sections.push(general);

  if (inline.length > 0) {
    const entries = inline.map((a, i) => entry(a, i + 1, planLines));
    sections.push(["Inline comments:", "", ...entries].join("\n"));
  }

  return sections.join("\n\n");
}
