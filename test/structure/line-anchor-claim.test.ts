// Standing gate for the line-anchor feedback claim (EXC-940). Three surfaces tell a
// reader how line-anchored feedback resolves — `abbreviate` in ui/src/lib/feedback.ts,
// `deniedMessage` in opencode/caret.plugin.ts, and doc/ARCHITECTURE.md's § Calling the
// review tool from your own skill. EXC-939 found the causality inverted in two of them:
// a wrong docstring had already propagated into a docs draft. It corrected the prose but
// added no mechanism, so this suite is the mechanism.
//
// What is pinned is only the half that is TRUE ON BOTH ADAPTERS — the one sentence in
// CLAIM below. The adapter-specific half around it (whether the numbers line up with the
// agent's own copy: they do on the Claude path, where writeCanonicalPlanFile rewrites the
// agent's plan file; they need not on OpenCode, which has no plan file) stays each
// surface's own prose, in its own voice for its own audience. A gate demanding three
// byte-identical paragraphs would flatten that, so this one never reads past the shared
// sentence.
//
// Comment syntax and line wrapping are noise here, so `prose` strips the markers and
// collapses whitespace before matching: each surface stays free to wrap however its
// formatter likes. Exactly-once rather than at-least-once, because feedback.ts carried
// the claim twice (module header AND abbreviate's docstring) and collapsing that
// duplicate is half the point.
//
// CLAIM is deliberately free of apostrophes, em-dashes, and ellipses: an editor that
// smartens quotes in one surface must not red this gate for a reason that has nothing to
// do with the claim.
//
// The one honest gap: this catches an EDIT or a DELETION of the claim, not a
// contradictory sentence ADDED beside an intact one. No mechanism at this weight catches
// that, and the drift EXC-939 found was a rewrite, not an addition.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CLAIM =
  "A feedback line reference indexes the plan version caret stored, and the " +
  "abbreviated quote paired with it is what the agent matches against its own text.";

// The suite sits at test/structure/, two levels below the repo root; resolving against
// import.meta.dir reads the real tree regardless of the runner's cwd.
const REPO_ROOT = join(import.meta.dir, "..", "..");

const SURFACES = ["ui/src/lib/feedback.ts", "opencode/caret.plugin.ts", "doc/ARCHITECTURE.md"];

/** The prose of a file with comment syntax and line breaks removed: drop leading line and
 * block comment markers, then collapse every whitespace run to one space. */
function prose(text: string): string {
  return text.replace(/^\s*(\/\/|\/\*\*?|\*\/|\*)/gm, " ").replace(/\s+/g, " ");
}

test.each(SURFACES)("%s states the line-anchor claim verbatim, once", (rel) => {
  const body = prose(readFileSync(join(REPO_ROOT, rel), "utf-8"));
  expect(body.split(CLAIM).length - 1).toBe(1);
});
