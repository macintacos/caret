// The `/` completion source: the skills the agent reviewing this plan can reach,
// offered in every feedback editor so a reviewer cites a name that agent will
// actually recognize (EXC-1176). Registers against the editorCompletion.ts seam
// and owns nothing else, so it and the file-reference source never touch the same
// lines. Reference only — caret does not execute a completed skill, and nothing
// here suggests it will.
//
// The list is captured ONCE PER REVIEW rather than re-fetched per keystroke: the
// daemon's walk crosses the plugin tree, which is far too much work to repeat on
// every character, and it is stateless, so the snapshot lives here. The promise is
// memoised by review id — not per editor — because a review has many feedback
// surfaces (the gutter composer, each annotation card, the dialogs) and they
// should share one fetch. The deliberate consequence: a skill added mid-review is
// not offered until the tab reloads.

import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";

import type { SkillRef } from "@core/lib/types";
import { getSkills } from "$lib/api.ts";
import type { ReviewCompletionSource } from "$lib/editorCompletion.ts";

/** `/` plus the characters a skill name may carry: word characters, the `:` that
 * namespaces a plugin skill, and the `.`/`-` that appear in ordinary skill names.
 * Doubles as `validFor`, so CodeMirror keeps filtering the same list while the
 * reviewer types rather than re-querying per character. */
const SKILL_TOKEN = /\/[\w:.-]*/;

/** One in-flight-or-settled fetch per review id, shared by every editor open on
 * that review. Keyed rather than per-source because each editor builds its own
 * source instance. */
const BY_REVIEW = new Map<string, Promise<SkillRef[]>>();

function skillsFor(
  reviewId: string,
  fetchSkills: (id: string) => Promise<SkillRef[]>,
): Promise<SkillRef[]> {
  const cached = BY_REVIEW.get(reviewId);
  if (cached) return cached;
  // Never rejects: a failed enumeration is "no completion", the same as an agent
  // with no skills, so the editor behaves as it did before completion existed.
  const pending = fetchSkills(reviewId).catch(() => []);
  BY_REVIEW.set(reviewId, pending);
  return pending;
}

/** Whether `/` at `at` opens a completion rather than sitting inside prose. A
 * slash is only a trigger at a word boundary, which is what keeps `src/lib` and
 * `./lib` from leaving a list open over the text. */
function atWordBoundary(context: CompletionContext, at: number): boolean {
  if (at === 0) return true;
  return /\s/.test(context.state.sliceDoc(at - 1, at));
}

function toOption(skill: SkillRef): Completion {
  // The label carries the leading `/` because `from` sits at the slash: it is both
  // what CodeMirror filters the reviewer's typing against and what gets inserted,
  // so a plugin skill inserts its namespaced `/plugin:skill` form.
  return { label: `/${skill.name}`, detail: skill.origin };
}

/**
 * The `/` source, bound to a review by the seam's factory contract.
 *
 * @param fetchSkills - How to enumerate a review's skills; defaults to the daemon
 *   round trip and is injectable so a unit drives a known list.
 */
export function skillCompletion(
  fetchSkills: (id: string) => Promise<SkillRef[]> = getSkills,
): ReviewCompletionSource {
  return (review) =>
    async (context: CompletionContext): Promise<CompletionResult | null> => {
      const match = context.matchBefore(SKILL_TOKEN);
      if (!match || !atWordBoundary(context, match.from)) return null;
      const skills = await skillsFor(review.reviewId, fetchSkills);
      // An agent with nothing to offer — codex today — returns null rather than an
      // empty result, so no popup paints at all.
      if (skills.length === 0) return null;
      return { from: match.from, options: skills.map(toOption), validFor: SKILL_TOKEN };
    };
}
