// The `/` completion source: the skills the agent reviewing this plan can reach,
// offered in every feedback editor so a reviewer cites a name that agent will
// actually recognize (EXC-1176). Registers against the editorCompletion.ts seam
// and owns nothing else, so it and the file-reference source never touch the same
// lines. Reference only — caret does not execute a completed skill, and nothing
// here suggests it will.
//
// The list is captured ONCE PER REVIEW rather than re-fetched per keystroke: the
// daemon's walk crosses the plugin tree, which is far too much work to repeat on
// every character, and it is stateless, so the snapshot lives here. The cache is
// keyed by review id because a review has many feedback surfaces (the gutter
// composer, each annotation card, the dialogs) and they should share one fetch;
// it lives in the factory's closure rather than at module scope because
// editorCompletion.ts builds the source once for the whole app, so the closure is
// already shared by every editor — and a test can then build its own. The
// deliberate consequence: a skill added mid-review is not offered until the tab
// reloads.

import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";

import type { SkillRef } from "@core/lib/types";
import { getSkills } from "$lib/api.ts";
import type { ReviewCompletionSource } from "$lib/editorCompletion.ts";

/** `/` plus the characters a skill name may carry: word characters, the `:` that
 * namespaces a plugin skill, the `.`/`-` of ordinary names, and `/` itself —
 * OpenCode names a nested command by its path (`team/deploy`), so without the
 * slash the list would die on the second segment of a name it had just offered.
 * Doubles as `validFor`, so CodeMirror keeps filtering the same list while the
 * reviewer types rather than re-querying per character. */
const SKILL_TOKEN = /\/[\w:.\-/]*/;

/** Whether the `/` at `at` opens a completion rather than sitting inside prose.
 * Only after whitespace, or at the start of the document — narrower than a word
 * boundary, and deliberately so: it is what keeps `src/lib` and `./lib` from
 * leaving a list open over the text. `matchBefore` anchors its match at the
 * cursor, so a multi-segment path is tested at its FIRST slash, not its last. */
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
 *   round trip and is injectable so a unit drives a known list. `null` reports a
 *   transient failure, and the source MAY also reject.
 */
export function skillCompletion(
  fetchSkills: (id: string) => Promise<SkillRef[] | null> = getSkills,
): ReviewCompletionSource {
  /** One in-flight-or-settled fetch per review id, shared by every editor on that
   * review. Only ANSWERS are kept: an empty list is one — the agent has no skills
   * — and stays cached, while a failure (a `null`, or a rejection from an injected
   * source) drops its entry so the next `/` asks again rather than disabling
   * completion for the rest of the tab's life over a daemon that was restarting.
   * The cost of that choice is bounded but real: a daemon that stays down is
   * re-asked once per keystroke of the token being typed. */
  const byReview = new Map<string, Promise<SkillRef[]>>();

  function skillsFor(reviewId: string): Promise<SkillRef[]> {
    const cached = byReview.get(reviewId);
    if (cached) return cached;
    // Never rejects: a failed enumeration is "no completion", the same as an agent
    // with no skills, so the editor behaves as it did before completion existed.
    const pending = fetchSkills(reviewId)
      .then((skills) => {
        if (skills === null) {
          byReview.delete(reviewId);
          return [];
        }
        return skills;
      })
      .catch(() => {
        byReview.delete(reviewId);
        return [];
      });
    byReview.set(reviewId, pending);
    return pending;
  }

  return (review) =>
    async (context: CompletionContext): Promise<CompletionResult | null> => {
      const match = context.matchBefore(SKILL_TOKEN);
      if (!match || !atWordBoundary(context, match.from)) return null;
      const skills = await skillsFor(review.reviewId);
      // An agent with nothing to offer — codex today — returns null rather than an
      // empty result, so no popup paints at all.
      if (skills.length === 0) return null;
      return { from: match.from, options: skills.map(toOption), validFor: SKILL_TOKEN };
    };
}
