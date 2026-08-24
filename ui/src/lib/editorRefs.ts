// Recognition for the feedback editors' reference chips (EXC-1177): which runs
// in a comment are references caret can actually resolve, so markdownEditor.ts
// can chip those and leave the rest as prose. It sits beside markdownEditor.ts
// for the same reason editorCompletion.ts does — that module owns the editor's
// styling and decoration, this one owns what there is to decorate.
//
// Recognition is semantic, never syntactic. A run's SHAPE only decides whether
// it is worth asking about; whether it exists is answered by the same two gates
// the completion sources use — resolveFileRefs() for a path, the shared
// per-review enumeration for a skill. Nothing here guesses, and nothing here
// surfaces a failure: a gate that cannot answer leaves the run plain, which is
// exactly how the editor behaved before chips existed.
//
// Presentation only. The recognized set is a set of STRINGS the decoration pass
// looks runs up in, so the document is never rewritten and what reaches the
// agent is byte-identical with chips or without.

import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import type { FileRefKind, SkillRef } from "@core/lib/types";
import { resolveFileRefs } from "$lib/api.ts";
import { classify, pathCandidates } from "$lib/diffview/fileRefs.ts";
import type { ReviewContext } from "$lib/editorCompletion.ts";
import { SKILL_TOKEN, type SkillLookup, skillsFor } from "$lib/skillCompletion.ts";

/** One reference-shaped run in the document. */
export interface RefToken {
  /** Start of the range a chip over this run would cover, in document offsets.
   * The run itself, widened to the whole codespan when it sits inside one. */
  from: number;
  /** End of that range, exclusive. */
  to: number;
  /** What recognition is keyed on: the path for a path run (the cited `:line` is
   * inside the chip but not inside the key), the `/name` for a skill run. */
  key: string;
  kind: "path" | "skill";
}

/** How long a keystroke defers the resolve behind it. Long enough that a typed
 * word costs one request rather than one per character, short enough that the
 * chip lands while the reviewer is still looking at what they typed. */
const DEBOUNCE_MS = 250;

/** The timer the debounce rides. Injected so a unit drives the window rather
 * than sleeping through it; `handle` is opaque because the browser and bun
 * disagree about what `setTimeout` returns. */
export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const REAL_TIMERS: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The gates recognition asks, and the timer it schedules on. Every one has a
 * production default; a unit overrides the ones its case is about. */
export interface RefRecognitionDeps {
  /** Which of these cwd-relative paths exist. Never rejects. */
  resolvePaths?: (reviewId: string, paths: string[]) => Promise<Record<string, FileRefKind>>;
  /** The reviewing agent's skills. Never rejects. */
  lookupSkills?: SkillLookup;
  timers?: Timers;
  delayMs?: number;
}

const NONE: ReadonlySet<string> = new Set();

/** Replaces the recognized set wholesale — the answer to one resolve, never a
 * merge, so a run that stopped resolving stops being in it. */
export const setRecognizedRefs = StateEffect.define<ReadonlySet<string>>();

/** The keys currently recognized. Read by the decoration pass in
 * markdownEditor.ts; empty on an editor with no review, which is what leaves
 * such a surface undecorated without a second code path. */
export const recognizedRefs = StateField.define<ReadonlySet<string>>({
  create: () => NONE,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setRecognizedRefs)) return effect.value;
    return value;
  },
});

/** The inline-code and fenced-code node ranges in `state`, read off the markdown
 * syntax tree rather than re-lexed with a regex — the same tree the decoration
 * pass walks, so the two cannot disagree about where code is. */
function codeRegions(state: EditorState): { inline: RangeLike[]; fenced: RangeLike[] } {
  const inline: RangeLike[] = [];
  const fenced: RangeLike[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "InlineCode") inline.push({ from: node.from, to: node.to });
      else if (node.name === "FencedCode") fenced.push({ from: node.from, to: node.to });
      else return undefined;
      return false;
    },
  });
  return { inline, fenced };
}

interface RangeLike {
  from: number;
  to: number;
}

/** A codespan's interior, or null when it holds whitespace — which makes it a
 * command or prose rather than a path, exactly as `buildFileRefLayer` reads it
 * (`bun test` must not offer `test`). Trimmed first, because CommonMark strips a
 * code span's one padding space either side. */
function soleToken(span: string): string | null {
  const fence = /^(`+)([\s\S]*?)\1$/.exec(span);
  const interior = (fence?.[2] ?? span).trim();
  return interior === "" || /\s/.test(interior) ? null : interior;
}

/** Blanks `ranges` out of `text` (offsets preserved) so a later scan cannot see
 * them. Cheaper and less error-prone than teaching every scan to skip ranges. */
function mask(text: string, ranges: readonly RangeLike[]): string {
  let masked = text;
  for (const r of ranges) {
    masked = masked.slice(0, r.from) + " ".repeat(r.to - r.from) + masked.slice(r.to);
  }
  return masked;
}

// A `/` opens a skill only after whitespace or at the start of the document —
// the same boundary skillCompletion applies, and what keeps `src/lib` and `./lib`
// from reading as one.
const SKILL_RUN = new RegExp(SKILL_TOKEN.source, "g");

/** Whether a bare-prose run is discriminating enough to spend a request on.
 *
 * This clause is the whole reason the editor may scan prose where the plan view
 * scans only inline code: `classify`'s floor is one letter in the last segment,
 * so without it every word is a candidate and `test` wears a chip the moment a
 * `test/` exists beside it. A separator is what distinguishes a path a reviewer
 * wrote from a word they wrote.
 *
 * ponytail: an extensionless file at the repo root — `Makefile`, `LICENSE` —
 * is therefore only recognized inside backticks, where the author's own
 * "this is a path" signal stands in for the separator. Widen this only with a
 * second signal to spend, never by dropping the clause. */
function worthAsking(path: string): boolean {
  return path.includes("/") || path.includes(".");
}

/**
 * The reference-shaped runs in `state`'s document, in document order.
 *
 * Pure, and deliberately opinionated about nothing else: a run appearing here
 * means only that it is worth asking a gate about. Fenced code is skipped
 * entirely; a single-token codespan is scanned without the prose clause and
 * reports the whole span (backticks included) as its chip range, so one codespan
 * wrapping one resolved reference is one chip rather than a pill inside a pill.
 */
export function scanRefTokens(state: EditorState): RefToken[] {
  const doc = state.doc.toString();
  const { inline, fenced } = codeRegions(state);
  const tokens: RefToken[] = [];

  for (const span of inline) {
    const interior = soleToken(doc.slice(span.from, span.to));
    if (interior === null) continue;
    const ref = classify(interior);
    if (ref !== null) tokens.push({ from: span.from, to: span.to, key: ref.path, kind: "path" });
  }

  // Prose is whatever code did not claim. Skill runs are taken first and masked
  // in turn, because CANDIDATE_RE admits `/` and would otherwise re-offer
  // `/team/deploy` as a path.
  const prose = mask(doc, [...inline, ...fenced]);
  const claimed: RangeLike[] = [];
  for (const m of prose.matchAll(SKILL_RUN)) {
    const at = m.index;
    if (at !== 0 && !/\s/.test(prose[at - 1] as string)) continue;
    claimed.push({ from: at, to: at + m[0].length });
    tokens.push({ from: at, to: at + m[0].length, key: m[0], kind: "skill" });
  }
  for (const c of pathCandidates(mask(prose, claimed))) {
    if (!worthAsking(c.path)) continue;
    tokens.push({ from: c.start, to: c.end, key: c.path, kind: "path" });
  }

  return tokens.sort((a, b) => a.from - b.from);
}

/** Which of `tokens`' keys the gates recognize. Never rejects: `resolveFileRefs`
 * and the skill enumeration both degrade to "nothing", which leaves every run
 * plain — the pre-chip behaviour, and never an error state. */
async function recognize(
  review: ReviewContext,
  tokens: readonly RefToken[],
  resolvePaths: NonNullable<RefRecognitionDeps["resolvePaths"]>,
  lookupSkills: SkillLookup,
): Promise<ReadonlySet<string>> {
  const paths = [...new Set(tokens.filter((t) => t.kind === "path").map((t) => t.key))];
  const wantsSkills = tokens.some((t) => t.kind === "skill");
  const [kinds, skills] = await Promise.all([
    // A review whose cwd never arrived can only ever 404, so it is not asked —
    // the same known answer fileCompletion declines to spend a request on.
    paths.length > 0 && review.cwd !== ""
      ? resolvePaths(review.reviewId, paths)
      : Promise.resolve<Record<string, FileRefKind>>({}),
    wantsSkills ? lookupSkills(review.reviewId) : Promise.resolve<SkillRef[]>([]),
  ]);
  const names = new Set(skills.map((s) => `/${s.name}`));
  const recognized = new Set<string>();
  for (const token of tokens) {
    const known = token.kind === "path" ? kinds[token.key] !== undefined : names.has(token.key);
    if (known) recognized.add(token.key);
  }
  return recognized;
}

function same(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((key) => b.has(key));
}

/**
 * Keeps `recognizedRefs` current for the review an editor composes against, or
 * contributes nothing at all when there is no review — so a surface mounted
 * outside one behaves exactly as it did before chips existed.
 *
 * The plugin declares no decorations: it is the lifecycle host for the resolve,
 * and the one decoration mechanism stays `codeHighlighter` in markdownEditor.ts.
 * Two rules govern the asking. A doc change REPLACES the armed timer rather than
 * adding one, so a burst of typing costs one request and not one per keystroke.
 * And every request carries a generation; an answer whose generation is no
 * longer the latest — because a newer request overtook it, or because the view
 * was destroyed under it — is dropped instead of dispatched.
 */
export function refRecognition(
  review: ReviewContext | undefined,
  deps: RefRecognitionDeps = {},
): Extension {
  if (review === undefined) return [];
  const {
    resolvePaths = resolveFileRefs,
    lookupSkills = skillsFor,
    timers = REAL_TIMERS,
    delayMs = DEBOUNCE_MS,
  } = deps;

  return [
    recognizedRefs,
    ViewPlugin.fromClass(
      class {
        private handle: unknown;
        private generation = 0;

        constructor(private readonly view: EditorView) {
          // A restored draft arrives already written, so the first pass is not a
          // reaction to typing. It still goes through the timer: dispatching from
          // inside the update that constructed the plugin is what CodeMirror
          // refuses.
          this.arm(0);
        }

        update(update: ViewUpdate): void {
          if (update.docChanged) this.arm(delayMs);
        }

        destroy(): void {
          timers.clear(this.handle);
          this.generation++;
        }

        private arm(ms: number): void {
          timers.clear(this.handle);
          this.handle = timers.set(() => void this.run(), ms);
        }

        private async run(): Promise<void> {
          const generation = ++this.generation;
          const tokens = scanRefTokens(this.view.state);
          const recognized = await recognize(review, tokens, resolvePaths, lookupSkills);
          if (generation !== this.generation) return;
          // Skipping a no-op dispatch keeps the field's identity stable, which is
          // what lets the decoration pass test it by reference.
          if (same(recognized, this.view.state.field(recognizedRefs))) return;
          this.view.dispatch({ effects: setRecognizedRefs.of(recognized) });
        }
      },
    ),
  ];
}
