// Plan-format validation for the review hook.
//
// A code block only syntax-highlights in the review webview when its opening
// fence carries a language marker (the info string `marked` turns into
// `class="language-X"`, which Shiki then styles — see ui/src/lib/render.ts).
// We detect untagged blocks here, host-side, before a plan is posted, so the
// human never sees an unhighlightable plan.

import { Marked } from "marked";

export const PLAN_FORMAT_DENY_MESSAGE =
  "caret: this plan has a code block with no language marker, so it can't be " +
  "syntax-highlighted in the review UI. Add a language tag to every code block's " +
  "opening fence (e.g. ```ts, ```bash, ```json), and use `text` for non-code " +
  "blocks like directory trees, console output, or ASCII art. Then resubmit the plan.";

/**
 * True when the plan markdown contains a code block with no language marker.
 *
 * Pure. Lexes with the same options the webview renderer uses
 * (ui/src/lib/render.ts) so "code block" means exactly what gets rendered, and
 * walks the full token tree via marked's own walker — descending into code
 * blocks nested in lists and blockquotes. Indented (4-space) blocks have no info
 * string and render unhighlighted, so they count as untagged. An absent, empty,
 * or whitespace-only plan has no code blocks and passes.
 */
export function hasUntaggedCodeBlock(plan: string | undefined): boolean {
  if (!plan?.trim()) return false;
  const marked = new Marked({ gfm: true, breaks: false });
  let untagged = false;
  marked.walkTokens(marked.lexer(plan), (token) => {
    if (token.type === "code" && !(token.lang ?? "").trim()) untagged = true;
  });
  return untagged;
}
