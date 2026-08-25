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
// surfaces a failure: a gate that cannot answer leaves the run plain, the same
// as a run it was never asked about.
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
  /** What the gate is asked about: the path for a path run (the cited `:line` is
   * inside the chip but not inside the key), the `/name` for a skill run. */
  key: string;
  kind: "path" | "skill";
}

/** How a token is keyed in `recognizedRefs`.
 *
 * The kind is part of the key rather than an invariant nothing checks, because
 * the two namespaces overlap: a skill key is always `/name`, and a path key can
 * be too — `classify("/git")` returns `{ path: "/git" }`, so a `` `/git` ``
 * codespan is a path candidate spelled exactly like the skill. Keyed on the
 * string alone, one gate's answer would grant the other's chip, which is a wrong
 * answer from the one thing this feature exists to make trustworthy. */
export function refKey(token: Pick<RefToken, "kind" | "key">): string {
  return `${token.kind}:${token.key}`;
}

/** How long a keystroke defers the resolve behind it. Long enough that a typed
 * word costs one request rather than one per character, short enough that the
 * chip lands while the reviewer is still looking at what they typed. */
const DEBOUNCE_MS = 250;

/** The gates recognition asks, and the timer it schedules on. Every one has a
 * production default; a unit overrides the ones its case is about. The timer
 * pair is spelled exactly as `AutosaveDeps`' is — the UI's other debounced
 * writer — so there is one shape for this rather than two. */
export interface RefRecognitionDeps {
  /** Which of these cwd-relative paths exist. Never rejects. */
  resolvePaths?: (reviewId: string, paths: string[]) => Promise<Record<string, FileRefKind>>;
  /** The reviewing agent's skills. Never rejects. */
  lookupSkills?: SkillLookup;
  /** Schedule the next resolve; returns a cancel handle. Defaults to setTimeout. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Cancel a scheduled resolve. Defaults to clearTimeout. */
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  delayMs?: number;
}

const NONE: ReadonlySet<string> = new Set();

/** Replaces the recognized set wholesale — the answer to one resolve, never a
 * merge, so a run that stopped resolving stops being in it. */
const setRecognizedRefs = StateEffect.define<ReadonlySet<string>>();

/** The `refKey`s currently recognized. Read by the decoration pass in
 * markdownEditor.ts; absent from an editor with no review, which is what leaves
 * such a surface undecorated without a second code path. */
export const recognizedRefs = StateField.define<ReadonlySet<string>>({
  create: () => NONE,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setRecognizedRefs)) return effect.value;
    return value;
  },
});

interface RangeLike {
  from: number;
  to: number;
}

/** The inline-code and code-block node ranges in `state`, read off the markdown
 * syntax tree rather than re-lexed with a regex — the same tree the decoration
 * pass walks, so the two cannot disagree about where code is. `CodeBlock` is
 * lezer's four-space indented block, which is neither `FencedCode` nor
 * `InlineCode` and would otherwise be scanned as prose. */
function codeRegions(state: EditorState): { inline: RangeLike[]; blocks: RangeLike[] } {
  const inline: RangeLike[] = [];
  const blocks: RangeLike[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "InlineCode") inline.push({ from: node.from, to: node.to });
      else if (node.name === "FencedCode" || node.name === "CodeBlock") {
        blocks.push({ from: node.from, to: node.to });
      } else return undefined;
      return false;
    },
  });
  return { inline, blocks };
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

/** What a masked-out region is replaced with. NUL rather than a space, because
 * blanking must not MANUFACTURE a boundary: masked with spaces,
 * `` `foo.ts`/deploy `` reads as a whitespace-preceded `/deploy` and offers a
 * skill at a boundary the reviewer never typed. NUL is in neither token class,
 * so it still bounds a run the way whitespace would. */
const MASK_CHAR = "\u0000";

/** Blanks `ranges` out of `text`, offsets preserved, so a later scan cannot see
 * them. Simpler than teaching every scan to skip ranges. */
function mask(text: string, ranges: readonly RangeLike[]): string {
  let masked = text;
  for (const r of ranges) {
    masked = masked.slice(0, r.from) + MASK_CHAR.repeat(r.to - r.from) + masked.slice(r.to);
  }
  return masked;
}

// A `/` opens a skill only after whitespace or at the start of the document —
// the same boundary skillCompletion applies, and what keeps `src/lib` and `./lib`
// from reading as one.
const SKILL_RUN = new RegExp(SKILL_TOKEN.source, "g");

/** Sentence punctuation a prose run absorbs but does not own.
 *
 * `CANDIDATE_RE` and `SKILL_TOKEN` both admit `.`, and `SKILL_TOKEN` admits `:`.
 * Inside a codespan the closing backtick bounds the run, so the plan view never
 * meets this; in prose nothing does, and `fix src/a.ts.` would ask the daemon
 * about `src/a.ts.` — which resolves to nothing. That failure is
 * indistinguishable from this feature's deliberate signal: the reviewer would
 * read "caret cannot find this" about a path that is perfectly real, at the end
 * of a sentence, which is the most ordinary place to write one. */
const TRAILING_STOP = /[.:]+$/;

/** `[from, to)` narrowed past any sentence punctuation it swallowed, with the
 * run's remaining text. Both halves move together, so the stop ends up outside
 * the chip as well as outside the key. */
function withoutTrailingStop(text: string, from: number, to: number): { run: string; to: number } {
  const run = text.slice(from, to).replace(TRAILING_STOP, "");
  return { run, to: from + run.length };
}

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

/** `from`, moved back over the `@` the reviewer completed with.
 *
 * `CANDIDATE_RE` does not admit `@`, so a run the `@` source inserted is offered
 * starting one character INSIDE the reference it wrote. The sigil is part of that
 * reference — it is what the insertion puts back (fileCompletion.ts) and what the
 * agent reads — so a chip that begins after it leaves the one character saying
 * "this is a reference" outside the pill.
 *
 * Only a BOUNDARY `@` moves the range, which is the same test the source itself
 * applies: `someone@host.com` is an address, and its `.com` tail is the candidate,
 * not a reference the reviewer completed. */
function withSigil(text: string, from: number): number {
  if (from === 0 || text[from - 1] !== "@") return from;
  return from === 1 || /\s/.test(text[from - 2] as string) ? from - 1 : from;
}

/**
 * The reference-shaped runs in `state`'s document, in document order.
 *
 * Pure, and deliberately opinionated about nothing else: a run appearing here
 * means only that it is worth asking a gate about. Code blocks are skipped; a
 * single-token codespan is scanned without the prose clause and reports the
 * whole span (backticks included) as its chip range, so one codespan wrapping
 * one resolved reference is one chip rather than a pill inside a pill.
 *
 * The scan covers the whole document rather than the viewport, because the
 * recognizer has to ask about references below the fold. CodeMirror only
 * guarantees the syntax tree is parsed *through* the viewport, so the code-region
 * skip is exact on screen and best-effort below it: a path inside a fence the
 * parser has not reached yet can be offered as prose, and would chip until it
 * catches up.
 *
 * An absolute path typed in prose (`/Users/x/foo.ts`) is claimed by the skill
 * scan when it sits at a word boundary, and offered to the path gate when it does
 * not. Neither ever chips — no such skill exists, and the daemon refuses an
 * absolute path — but that is why one shows up under whichever kind it does.
 */
export function scanRefTokens(state: EditorState): RefToken[] {
  const doc = state.doc.toString();
  const { inline, blocks } = codeRegions(state);
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
  const prose = mask(doc, [...inline, ...blocks]);
  const claimed: RangeLike[] = [];
  for (const m of prose.matchAll(SKILL_RUN)) {
    const at = m.index;
    if (at !== 0 && !/\s/.test(prose[at - 1] as string)) continue;
    claimed.push({ from: at, to: at + m[0].length });
    const { run, to } = withoutTrailingStop(prose, at, at + m[0].length);
    // A bare `/` names no skill; it is the sigil with nothing after it.
    if (run.length > 1) tokens.push({ from: at, to, key: run, kind: "skill" });
  }
  for (const c of pathCandidates(mask(prose, claimed))) {
    const { run, to } = withoutTrailingStop(prose, c.start, c.end);
    const ref = classify(run);
    if (ref === null || !worthAsking(ref.path)) continue;
    tokens.push({ from: withSigil(prose, c.start), to, key: ref.path, kind: "path" });
  }

  return tokens.sort((a, b) => a.from - b.from);
}

/** Which of `tokens` the gates recognize, as `refKey`s. Never rejects:
 * `resolveFileRefs` and the skill enumeration both degrade to "nothing", which
 * leaves every run plain — the pre-chip behaviour, and never an error state. */
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
    // hasOwn, not `!== undefined`: the response is JSON.parse'd, so every
    // Object.prototype member answers for itself and a `` `constructor` ``
    // codespan would otherwise chip as a resolved file.
    const known = token.kind === "path" ? Object.hasOwn(kinds, token.key) : names.has(token.key);
    if (known) recognized.add(refKey(token));
  }
  return recognized;
}

function same(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((key) => b.has(key));
}

/**
 * Keeps `recognizedRefs` current for the review an editor composes against, or
 * contributes nothing at all when there is no review — so a surface mounted
 * outside one renders every run as plain prose.
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
  const { resolvePaths = resolveFileRefs, lookupSkills = skillsFor, delayMs = DEBOUNCE_MS } = deps;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h));

  return [
    recognizedRefs,
    ViewPlugin.fromClass(
      class {
        private handle: ReturnType<typeof setTimeout> | undefined;
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
          if (this.handle !== undefined) clearTimer(this.handle);
          this.generation++;
        }

        private arm(ms: number): void {
          if (this.handle !== undefined) clearTimer(this.handle);
          this.handle = setTimer(() => void this.run(), ms);
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
