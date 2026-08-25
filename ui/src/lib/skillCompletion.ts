// The `/` completion source: the skills the agent reviewing this plan can reach,
// offered in every feedback editor so a reviewer cites a name that agent will
// actually recognize (EXC-1176). Registers against the editorCompletion.ts seam
// and owns nothing else, so it and the file-reference source never touch the same
// lines. Reference only — caret does not execute a completed skill, and nothing
// here suggests it will.
//
// The list offers NAMES. What a highlighted name means is a second, separate
// question, asked only when the reviewer opens the Ctrl+Space preview panel over
// it (EXC-1186): one round trip per highlighted row, carrying back that skill's
// own `description` and nothing else from its file.
//
// The list is captured ONCE PER REVIEW rather than re-fetched per keystroke: the
// daemon's walk crosses the plugin tree, which is far too much work to repeat on
// every character, and it is stateless, so the snapshot lives here. `skillsFor`
// is that capture, keyed by review id because a review has many feedback surfaces
// (the gutter composer, each annotation card, the dialogs) and they share one
// fetch — as does the chip recognizer in editorRefs.ts, which asks the same
// question about the same review. `createSkillCache` is the seam a unit builds
// its own through. The deliberate consequence: a skill added mid-review is not
// offered until the tab reloads.

import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";

import type { SkillRef } from "@core/lib/types";
import { getSkillDescription, getSkills } from "$lib/api.ts";
import { type PreviewToggle, previewPanel, previewToggle } from "$lib/completionPreview.ts";
import type { ReviewCompletionSource } from "$lib/editorCompletion.ts";

/** `/` plus the characters a skill name may carry: word characters, the `:` that
 * namespaces a plugin skill, the `.`/`-` of ordinary names, and `/` itself —
 * OpenCode names a nested command by its path (`team/deploy`), so without the
 * slash the list would die on the second segment of a name it had just offered.
 * Doubles as `validFor`, so CodeMirror keeps filtering the same list while the
 * reviewer types rather than re-querying per character, and as the editor chip
 * scan's skill tokenizer (`$lib/editorRefs.ts`), so what completes and what wears
 * a chip are the same shape. */
export const SKILL_TOKEN = /\/[\w:.\-/]*/;

/** Whether the `/` at `at` opens a completion rather than sitting inside prose.
 * Only after whitespace, or at the start of the document — narrower than a word
 * boundary, and deliberately so: it is what keeps `src/lib` and `./lib` from
 * leaving a list open over the text. `matchBefore` anchors its match at the
 * cursor, so a multi-segment path is tested at its FIRST slash, not its last. */
function atWordBoundary(context: CompletionContext, at: number): boolean {
  if (at === 0) return true;
  return /\s/.test(context.state.sliceDoc(at - 1, at));
}

function toOption(skill: SkillRef, info: Completion["info"]): Completion {
  // The label carries the leading `/` because `from` sits at the slash: it is both
  // what CodeMirror filters the reviewer's typing against and what gets inserted,
  // so a plugin skill inserts its namespaced `/plugin:skill` form.
  return { label: `/${skill.name}`, detail: skill.origin, info };
}

/** Asking what one skill does. Never rejects — `api.ts` degrades every failure to
 * null, which is the same answer a skill that describes itself nowhere gives, and
 * the panel has one thing to say for both. */
export type DescribeSkill = (reviewId: string, skill: SkillRef) => Promise<string | null>;

/** What the panel says for a null. Not an error state: plenty of skills carry no
 * `description`, and the reviewer asked what this one is rather than asking
 * caret to prove it could read the file. */
const NO_DESCRIPTION = "No description.";

/**
 * The preview panel for one skill row: its own description, or the sentence
 * above.
 *
 * Handed back SYNCHRONOUSLY with an empty body the read fills in when it lands —
 * `updateSel`'s async branch skips the `aria-describedby` wiring its sync branch
 * does, so a row that awaited its answer would go undescribed to a screen reader
 * and the panel would arrive late. `destroy`, which CodeMirror calls the moment
 * the selection moves, cancels that write: a read landing after the reviewer has
 * arrowed on would fill an element no longer on screen.
 *
 * The lookup key is the SkillRef rather than the label: `origin` is what tells
 * two roots offering one bare name apart, and the label's leading `/` is an
 * insertion detail no route knows about.
 */
function skillPreview(
  describe: DescribeSkill,
  reviewId: string,
  skill: SkillRef,
): (option: Completion) => { dom: HTMLElement; destroy: () => void } {
  return (option) => {
    const { dom, body } = previewPanel(option.label);
    let live = true;
    void describe(reviewId, skill).then((description) => {
      if (live) body.textContent = description ?? NO_DESCRIPTION;
    });
    return {
      dom,
      destroy: () => {
        live = false;
      },
    };
  };
}

/** A review's skills, however they are obtained. Never rejects — a failed
 * enumeration is an empty list, the same as an agent with no skills. */
export type SkillLookup = (reviewId: string) => Promise<SkillRef[]>;

/**
 * A lookup that walks a review's skills at most once.
 *
 * @param fetchSkills - How to enumerate a review's skills; defaults to the daemon
 *   round trip and is injectable so a unit drives a known list. `null` reports a
 *   transient failure, and unlike the `SkillLookup` this returns, it MAY reject —
 *   wrapping it is exactly what makes the lookup never reject.
 */
export function createSkillCache(
  fetchSkills: (id: string) => Promise<SkillRef[] | null> = getSkills,
): SkillLookup {
  /** One in-flight-or-settled fetch per review id, shared by every caller on that
   * review. Only ANSWERS are kept: an empty list is one — the agent has no skills
   * — and stays cached, while a failure (a `null`, or a rejection from an injected
   * source) drops its entry so the next ask retries rather than disabling
   * completion for the rest of the tab's life over a daemon that was restarting.
   * The cost of that choice is bounded but real: a daemon that stays down is
   * re-asked once per keystroke of the token being typed. */
  const byReview = new Map<string, Promise<SkillRef[]>>();

  return function skillsFor(reviewId: string): Promise<SkillRef[]> {
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
  };
}

/** The one enumeration the app reads: the `/` source here and the editor's chip
 * recognizer (`$lib/editorRefs.ts`) share it, so a review's plugin tree is walked
 * once however many surfaces ask about it. Module-level because
 * `editorCompletion.ts` already builds the `/` source once for the whole app, so
 * this widens who shares that instance rather than introducing shared state;
 * `createSkillCache` is the seam a unit builds its own through. */
export const skillsFor: SkillLookup = createSkillCache();

/**
 * The `/` source, bound to a review by the seam's factory contract.
 *
 * @param fetchSkills - How to enumerate a review's skills. Omitted, the source
 *   reads the shared `skillsFor`; injected, it gets a cache of its own, so a
 *   unit's list can neither answer from nor leak into the app's. `null` reports a
 *   transient failure, and the source MAY also reject.
 * @param describe - How to read one skill's own description for the preview
 *   panel. Deliberately NOT cached the way the enumeration is: it is one small
 *   read per highlighted row, and CodeMirror destroys the panel on every
 *   selection change, so a cache would save a request and repaint anyway.
 * @param toggle - Whether the reviewer has the panel open. Injected, a unit gets
 *   one of its own, so its state can neither be read from nor leak into the app's.
 */
export function skillCompletion(
  fetchSkills?: (id: string) => Promise<SkillRef[] | null>,
  describe: DescribeSkill = getSkillDescription,
  toggle: PreviewToggle = previewToggle,
): ReviewCompletionSource {
  const lookup = fetchSkills === undefined ? skillsFor : createSkillCache(fetchSkills);

  return (review) =>
    async (context: CompletionContext): Promise<CompletionResult | null> => {
      const match = context.matchBefore(SKILL_TOKEN);
      if (!match || !atWordBoundary(context, match.from)) return null;
      const skills = await lookup(review.reviewId);
      // An agent with nothing to offer — codex today — returns null rather than an
      // empty result, so no popup paints at all.
      if (skills.length === 0) return null;
      // The toggle is read HERE, at query time, and not by the panel at render
      // time: `updateSel` re-evaluates `info` only when the selected element
      // changes, so a panel that asked would never be asked again — see
      // completionPreview.ts. Each row gets its own, because each names a
      // different skill.
      const options = skills.map((skill) =>
        toOption(skill, toggle.on() ? skillPreview(describe, review.reviewId, skill) : undefined),
      );
      return { from: match.from, options, validFor: SKILL_TOKEN };
    };
}
