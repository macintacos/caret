// Reads one skill document's own `description` for the completion preview panel
// (EXC-1186): the reviewer highlights a name in the `/` list and asks for its
// description, and this is the only path on which a skill author's file is
// opened at all. The enumerators beside it read directory names and nothing else.
//
// Containment lives HERE and nowhere else. `relative` is built from a name that
// arrived from the browser, and OpenCode legitimately names a nested command with
// a `/`, so a `../` in it is ordinary input rather than a hypothetical: every
// caller passes an untrusted tail, and each gets the same check — including the
// one that only wants to know whether the file is there, which is why
// `containedFile` is exported beside the one-shot `readDescriptionUnder`. The
// posture is `contained()`'s in @/plan/excerpt.ts — realpath first, then require
// the result under the realpathed root, so a symlink pointing out of the root is
// refused rather than followed — narrowed to one file under one root.
//
// The frontmatter parser is deliberately not a YAML engine: it reads the `---`
// block at the top of the file and the one `description` key in it, in the forms
// skill authors actually write. Anything it cannot read is null, which the UI
// renders as "no description" — an ordinary answer, not an error. A dependency
// for this much is what dependency-rules.md exists to refuse.

import { readFile, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";

/** The fence that opens and closes a frontmatter block. */
const FENCE = "---";

/** Past this a document is not a skill doc. The frontmatter block sits in the
 * first lines, so nothing larger holds an answer worth decoding the rest of the
 * file for — and this path runs once per highlighted row, on a name that arrived
 * from the browser. The sibling preview reader bounds itself the same way
 * (`MAX_EXCERPT_BYTES` in @/plan/excerpt.ts). */
const MAX_DOC_BYTES = 1024 * 1024;

/** The one key read, at the top level of the block only — an indented
 * `description:` belongs to some other key's mapping, not to the document. */
const DESCRIPTION_LINE = /^description:[ \t]*(.*)$/;

/** A block-scalar introducer: `|` or `>`, then the chomp and indentation
 * indicators YAML lets ride along (`|-`, `>+`, `|2`, `|-2`). */
const BLOCK_INTRODUCER = /^([|>])[-+]?\d*$/;

/** How a block scalar's lines join — `|` keeps the line breaks, `>` folds them
 * into spaces — or undefined when `value` is not a block scalar at all.
 *
 * The chomp and indentation indicators are read and then ignored: they change
 * only trailing newlines and relative indentation, neither of which a trimmed
 * one-paragraph description can show. Recognising them still matters, because a
 * `|+` this did not recognise would fall through to the scalar branch and render
 * the introducer itself as the skill's description. */
function blockJoiner(value: string): string | undefined {
  const introducer = BLOCK_INTRODUCER.exec(value)?.[1];
  if (introducer === undefined) return undefined;
  return introducer === "|" ? "\n" : " ";
}

/** The canonical path of `<root>/<relative>` when it really sits under `root`,
 * else null. Both ends are realpathed before comparison, so neither a `..` in
 * `relative` nor a symlink whose target leaves the tree gets through.
 *
 * Exported for the caller that resolves a name across several roots and needs
 * the FILE to decide which one answers: probing with a plain `access` on a joined
 * path would put a second, unchecked resolution of the same untrusted name beside
 * this one. */
export async function containedFile(root: string, relative: string): Promise<string | null> {
  const [rootReal, real] = await Promise.all([
    realpath(root).catch(() => null),
    realpath(join(root, relative)).catch(() => null),
  ]);
  if (rootReal === null || real === null) return null;
  return real === rootReal || real.startsWith(rootReal + sep) ? real : null;
}

/** The lines of the frontmatter block at the very top of `content`, or null when
 * the file does not open with one or never closes it.
 *
 * A CRLF file is normalized here, once, so everything downstream reads a plain
 * line: any skill authored or cloned with CRLF endings arrives this way on every
 * platform, and a `\r` left on the end of `description: …` is invisible right up
 * until the key fails to match and a described skill reports having none. */
function frontmatterLines(content: string): string[] | null {
  const lines = content.split("\n").map((line) => line.replace(/\r$/, ""));
  if (lines[0]?.trimEnd() !== FENCE) return null;
  const close = lines.findIndex((line, i) => i > 0 && line.trimEnd() === FENCE);
  return close === -1 ? null : lines.slice(1, close);
}

/** A scalar with one layer of matching quotes removed. */
function unquote(value: string): string {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote)) {
    return value.slice(1, -1);
  }
  return value;
}

/** The body of a block scalar: the more-indented lines that follow it, ending at
 * the first line that starts a new key. Each line is trimmed, so a description
 * loses any relative indentation of its own — irrelevant to one paragraph of
 * prose, and what keeps this a reader rather than a YAML engine. */
function blockScalar(rest: string[], joiner: string): string {
  const taken: string[] = [];
  for (const line of rest) {
    if (line.trim() !== "" && !/^[ \t]/.test(line)) break;
    taken.push(line.trim());
  }
  // Folding drops the blank lines rather than turning them into the paragraph
  // breaks YAML makes of them; kept text keeps them, where they are visible.
  const kept = joiner === "\n" ? taken : taken.filter((line) => line !== "");
  return kept.join(joiner).trim();
}

/** The `description` value from a frontmatter block's lines, or null. */
function descriptionIn(block: string[]): string | null {
  const at = block.findIndex((line) => DESCRIPTION_LINE.test(line));
  if (at === -1) return null;
  const value = (block[at]?.match(DESCRIPTION_LINE)?.[1] ?? "").trimEnd();
  const joiner = blockJoiner(value);
  const text =
    joiner === undefined ? unquote(value).trim() : blockScalar(block.slice(at + 1), joiner);
  return text === "" ? null : text;
}

/** The `description` from the frontmatter of the file at `abs`, or null. Never
 * throws. Takes a path containment has already decided on — `containedFile` and
 * `readDescriptionUnder` are the two ways to get one. */
export async function descriptionOf(abs: string): Promise<string | null> {
  const size = await stat(abs).then(
    (s) => s.size,
    () => null,
  );
  if (size === null || size > MAX_DOC_BYTES) return null;
  let content: string;
  try {
    content = await readFile(abs, "utf-8");
  } catch {
    return null; // unreadable — a directory in the file's place, a permission wall.
  }
  const block = frontmatterLines(content);
  return block === null ? null : descriptionIn(block);
}

/** The `description` from the frontmatter of `<root>/<relative>`, or null.
 * Never throws.
 *
 * Null covers every miss with one answer — the file is absent, unreadable, too
 * large to be a skill doc, or outside `root`; it has no frontmatter, no
 * `description`, or one this parser cannot read — because the caller has nothing
 * different to do with any of them: the panel says the skill has no description
 * either way. */
export async function readDescriptionUnder(root: string, relative: string): Promise<string | null> {
  const abs = await containedFile(root, relative);
  return abs === null ? null : descriptionOf(abs);
}
