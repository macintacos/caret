// Deterministic feedback formatting. The result is sent verbatim as the
// `deny.message` the model reads when changes are requested, so the shape must
// be stable and readable: an optional general comment, then a numbered list of
// inline comments quoting the annotated passage.

import type { Annotation } from "./types.ts";

/** Collapses any run of whitespace (incl. newlines) to a single space. */
function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Formats annotations + a general comment into a single feedback string.
 * Annotations with blank comments are skipped; numbering follows array order.
 * Returns "" when there is nothing to say.
 */
export function formatFeedback(annotations: Annotation[], generalComment: string): string {
  const general = generalComment.trim();

  const inline = annotations
    .map((a) => ({ quote: flatten(a.quote), comment: a.comment.trim() }))
    .filter((a) => a.comment.length > 0);

  const sections: string[] = [];
  if (general) sections.push(general);

  if (inline.length > 0) {
    const lines = ["Inline comments:", ""];
    inline.forEach((a, i) => {
      lines.push(`${i + 1}. On "${a.quote}": ${a.comment}`);
    });
    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
}
