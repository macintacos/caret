// Deterministic feedback formatting. The result is sent verbatim as the
// `deny.message` the model reads when changes are requested, so the shape must
// be stable and readable: an optional general comment, then a numbered list of
// inline comments referencing the annotated passage — by quoted text for
// legacy annotations, by line range for line-anchored ones.

import { type Annotation, isLegacyAnnotation } from "@core/types";

/** Collapses any run of whitespace (incl. newlines) to a single space. */
function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The "On …" reference for one annotation: a quote for the legacy shape, a
 * 1-based line range for the line-anchored shape. */
function reference(a: Annotation): string {
  if (isLegacyAnnotation(a)) return `"${flatten(a.quote)}"`;
  return a.startLine === a.endLine ? `line ${a.startLine}` : `lines ${a.startLine}-${a.endLine}`;
}

/**
 * Formats annotations + a general comment into a single feedback string.
 * Annotations with blank comments are skipped; numbering follows array order.
 * Returns "" when there is nothing to say.
 */
export function formatFeedback(annotations: Annotation[], generalComment: string): string {
  const general = generalComment.trim();

  const inline = annotations
    .map((a) => ({ reference: reference(a), comment: a.comment.trim() }))
    .filter((a) => a.comment.length > 0);

  const sections: string[] = [];
  if (general) sections.push(general);

  if (inline.length > 0) {
    const lines = ["Inline comments:", ""];
    inline.forEach((a, i) => {
      lines.push(`${i + 1}. On ${a.reference}: ${a.comment}`);
    });
    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
}
