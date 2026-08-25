// Reads one skill document's own `description` for the completion preview panel
// (EXC-1186): the reviewer highlights a name in the `/` list and asks for its
// description, and this is the only path on which a skill author's file is
// opened at all. The enumerators beside it read directory names and nothing else.
//
// Containment lives HERE and nowhere else. `relative` is built from a name that
// arrived from the browser, and OpenCode legitimately names a nested command with
// a `/`, so a `../` in it is ordinary input rather than a hypothetical: every
// caller passes an untrusted tail, and each gets the same check. The posture is
// `contained()`'s in @/plan/excerpt.ts — realpath first, then require the result
// under the realpathed root, so a symlink pointing out of the root is refused
// rather than followed — narrowed to one file under one root.
//
// The frontmatter parser is deliberately not a YAML engine: it reads the `---`
// block at the top of the file and the one `description` key in it, in the forms
// skill authors actually write. Anything it cannot read is null, which the UI
// renders as "no description" — an ordinary answer, not an error. A dependency
// for this much is what dependency-rules.md exists to refuse.

import { readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";

/** The fence that opens and closes a frontmatter block. */
const FENCE = "---";

/** The one key read, at the top level of the block only — an indented
 * `description:` belongs to some other key's mapping, not to the document. */
const DESCRIPTION_LINE = /^description:[ \t]*(.*)$/;

/** The block-scalar introducers, mapped to how their lines join: `|` keeps the
 * line breaks, `>` folds them into spaces. The `-` (chomp) variants differ only
 * in trailing newlines, which a trimmed one-paragraph description cannot show,
 * so they are handled as their plain forms rather than modelled. */
const BLOCK_SCALARS: Readonly<Record<string, string>> = {
  "|": "\n",
  "|-": "\n",
  ">": " ",
  ">-": " ",
};

/** The canonical path of `<root>/<relative>` when it really sits under `root`,
 * else null. Both ends are realpathed before comparison, so neither a `..` in
 * `relative` nor a symlink whose target leaves the tree gets through. */
async function containedFile(root: string, relative: string): Promise<string | null> {
  const [rootReal, real] = await Promise.all([
    realpath(root).catch(() => null),
    realpath(join(root, relative)).catch(() => null),
  ]);
  if (rootReal === null || real === null) return null;
  return real === rootReal || real.startsWith(rootReal + sep) ? real : null;
}

/** The lines of the frontmatter block at the very top of `content`, or null when
 * the file does not open with one or never closes it. */
function frontmatterLines(content: string): string[] | null {
  const lines = content.split("\n");
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
  const joiner = BLOCK_SCALARS[value];
  const text =
    joiner === undefined ? unquote(value).trim() : blockScalar(block.slice(at + 1), joiner);
  return text === "" ? null : text;
}

/** The `description` from the frontmatter of `<root>/<relative>`, or null.
 * Never throws.
 *
 * Null covers every miss with one answer — the file is absent, unreadable, or
 * outside `root`; it has no frontmatter, no `description`, or one this parser
 * cannot read — because the caller has nothing different to do with any of them:
 * the panel says the skill has no description either way. */
export async function readDescriptionUnder(root: string, relative: string): Promise<string | null> {
  const abs = await containedFile(root, relative);
  if (abs === null) return null;
  let content: string;
  try {
    content = await readFile(abs, "utf-8");
  } catch {
    return null; // unreadable — a directory in the file's place, a permission wall.
  }
  const block = frontmatterLines(content);
  return block === null ? null : descriptionIn(block);
}
