// Standing gate for the line-anchor feedback claim (EXC-940). Three surfaces tell a
// reader how line-anchored feedback resolves — the module header of ui/src/lib/feedback.ts,
// `deniedMessage` in opencode/caret.plugin.ts, and doc/ARCHITECTURE.md's § Calling the
// review tool from your own skill. EXC-939 found the causality inverted in two of them:
// a wrong docstring had already propagated into a docs draft. It corrected the prose but
// added no mechanism, so this suite is the mechanism.
//
// What is pinned is only the half that is TRUE ON BOTH ADAPTERS — the one sentence in
// CLAIM below. The adapter-specific half around it (whether the numbers line up with the
// agent's own copy: they usually do on the Claude path, where writeCanonicalPlanFile
// mirrors the canonical text back onto the agent's plan file — best-effort, see
// src/plan/canonical-file.ts; they need not on OpenCode, which has no plan file) stays
// each surface's own prose, in its own voice for its own audience. A gate demanding three
// byte-identical paragraphs would flatten that, so this one never reads past the shared
// sentence.
//
// Exactly-once rather than at-least-once: one file restating the claim in two places is
// how the two copies drift apart, so a second copy reds here.
//
// CLAIM is deliberately free of apostrophes, em-dashes, and ellipses: an editor that
// smartens quotes in one surface must not red this gate for a reason that has nothing to
// do with the claim. Markdown emphasis or a link inside the sentence breaks the match
// too — put either outside it.
//
// Two honest gaps. This catches an EDIT or a DELETION of the claim, not a contradictory
// sentence ADDED beside an intact one; no mechanism at this weight catches that, and the
// drift EXC-939 found was a rewrite, not an addition. And it checks the file, not the
// docstring — a sentence that migrates elsewhere in the same file still passes.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CLAIM =
  "A feedback line reference indexes the plan version caret stored, and the " +
  "abbreviated quote paired with it is what the agent matches against its own text.";

// From import.meta.dir, not cwd, so the suite reads the real tree wherever it runs.
const REPO_ROOT = join(import.meta.dir, "..", "..");

const SURFACES = ["ui/src/lib/feedback.ts", "opencode/caret.plugin.ts", "doc/ARCHITECTURE.md"];

/** The prose of a file with its markup and line breaks removed: drop leading line-comment,
 * block-comment, and blockquote markers, then collapse every whitespace run to one space.
 * Each surface stays free to wrap the claim however its formatter likes. */
function prose(text: string): string {
  return text.replace(/^\s*(\/\/|\/\*\*?|\*\/|\*|>)/gm, " ").replace(/\s+/g, " ");
}

test.each(SURFACES)("%s states the line-anchor claim verbatim, once", (rel) => {
  const body = prose(readFileSync(join(REPO_ROOT, rel), "utf-8"));
  expect(body.split(CLAIM).length - 1).toBe(1);
});
