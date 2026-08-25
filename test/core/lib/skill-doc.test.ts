import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { readDescriptionUnder } from "@/lib/skill-doc.ts";

// `readDescriptionUnder` is the one place containment is decided, so these drive
// it over real files under a throwaway temp tree rather than a fake filesystem: a
// `..` and a symlink only escape for real on a real disk (EXC-1186). The
// filenames here are deliberately generic — the convention is the caller's.

let tmp: string;
let root: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "caret-skill-doc-"));
  root = join(tmp, "root");
  await mkdir(root, { recursive: true });
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** Write `<root>/<relative>`, creating its parent. */
async function seed(relative: string, content: string): Promise<void> {
  const path = join(root, relative);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

test("reads a plain scalar description", async () => {
  await seed("a/doc.md", "---\nname: a\ndescription: Use when planning\n---\n\n# body\n");
  expect(await readDescriptionUnder(root, "a/doc.md")).toBe("Use when planning");
});

test("strips double quotes from a quoted scalar", async () => {
  await seed("a/doc.md", '---\ndescription: "Use when: planning"\n---\n');
  expect(await readDescriptionUnder(root, "a/doc.md")).toBe("Use when: planning");
});

test("strips single quotes from a quoted scalar", async () => {
  await seed("a/doc.md", "---\ndescription: 'Use when planning'\n---\n");
  expect(await readDescriptionUnder(root, "a/doc.md")).toBe("Use when planning");
});

test("folds a `>` block scalar onto one line", async () => {
  await seed("a/doc.md", "---\ndescription: >\n  Use when planning\n  a release\n---\n");
  expect(await readDescriptionUnder(root, "a/doc.md")).toBe("Use when planning a release");
});

test("folds a `>-` block scalar the same way", async () => {
  await seed("a/doc.md", "---\ndescription: >-\n  Use when planning\n  a release\n---\n");
  expect(await readDescriptionUnder(root, "a/doc.md")).toBe("Use when planning a release");
});

test("keeps the line breaks of a `|` block scalar", async () => {
  await seed("a/doc.md", "---\ndescription: |\n  First line\n  Second line\n---\n");
  expect(await readDescriptionUnder(root, "a/doc.md")).toBe("First line\nSecond line");
});

test("keeps the line breaks of a `|-` block scalar", async () => {
  await seed("a/doc.md", "---\ndescription: |-\n  First line\n  Second line\n---\n");
  expect(await readDescriptionUnder(root, "a/doc.md")).toBe("First line\nSecond line");
});

test("reads a block scalar whose introducer carries a chomp indicator", async () => {
  // `|+`, `>+` and the indentation-indicator forms are as legal as `|` and `|-`,
  // and they differ only in trailing newlines. Read as their plain forms rather
  // than falling through to the scalar branch, which would render the introducer
  // itself as the description.
  await seed("a/doc.md", "---\ndescription: |+\n  First line\n  Second line\n---\n");
  expect(await readDescriptionUnder(root, "a/doc.md")).toBe("First line\nSecond line");
});

test("ends a block scalar at the next key, not at the end of the block", async () => {
  await seed("a/doc.md", "---\ndescription: >\n  Use when planning\nname: a\n---\n");
  expect(await readDescriptionUnder(root, "a/doc.md")).toBe("Use when planning");
});

test("reads a description whose file has CRLF line endings", async () => {
  // Not a Windows-only shape: any skill whose file was authored or committed with
  // CRLF arrives this way on macOS too, and a checkout with `core.autocrlf=true`
  // turns every cloned plugin skill into this case at once. The fences already
  // tolerate the `\r`, so without this the block is found and then read as empty
  // — a skill that has a description reported as having none.
  await seed("a/doc.md", "---\r\ndescription: Use when planning\r\n---\r\n");
  expect(await readDescriptionUnder(root, "a/doc.md")).toBe("Use when planning");
});

test("reads a CRLF block scalar", async () => {
  await seed("a/doc.md", "---\r\ndescription: |\r\n  First line\r\n  Second line\r\n---\r\n");
  expect(await readDescriptionUnder(root, "a/doc.md")).toBe("First line\nSecond line");
});

test("reads only the frontmatter, never a `description:` in the body", async () => {
  await seed("a/doc.md", "---\nname: a\n---\n\ndescription: not this one\n");
  expect(await readDescriptionUnder(root, "a/doc.md")).toBeNull();
});

test("yields null when the file opens with no frontmatter fence", async () => {
  await seed("a/doc.md", "# a\n\ndescription: not frontmatter\n");
  expect(await readDescriptionUnder(root, "a/doc.md")).toBeNull();
});

test("yields null when the frontmatter is never closed", async () => {
  await seed("a/doc.md", "---\ndescription: Use when planning\n");
  expect(await readDescriptionUnder(root, "a/doc.md")).toBeNull();
});

test("yields null when the frontmatter carries no description", async () => {
  await seed("a/doc.md", "---\nname: a\n---\n");
  expect(await readDescriptionUnder(root, "a/doc.md")).toBeNull();
});

test("yields null for an empty description", async () => {
  await seed("a/doc.md", "---\ndescription:\n---\n");
  expect(await readDescriptionUnder(root, "a/doc.md")).toBeNull();
});

test("yields null when the file does not exist", async () => {
  expect(await readDescriptionUnder(root, "nowhere/doc.md")).toBeNull();
});

test("yields null when the root does not exist", async () => {
  expect(await readDescriptionUnder(join(tmp, "nowhere"), "a/doc.md")).toBeNull();
});

test("yields null when the target is unreadable, rather than throwing", async () => {
  // A directory where a file is expected: the read fails with EISDIR, the one
  // failure mode that reproduces anywhere without permission games.
  await mkdir(join(root, "a", "doc.md"), { recursive: true });
  let reached = false;
  const got = await readDescriptionUnder(root, "a/doc.md").then((v) => {
    reached = true; // the caller continues past the failed read
    return v;
  });
  expect(got).toBeNull();
  expect(reached).toBe(true);
});

test("yields null for binary bytes inside a real fence, rather than throwing", async () => {
  // The fence opens for real, so the parser runs over the bytes instead of
  // bailing at the first line — which is the only way this pins anything about
  // the bytes themselves.
  await seed("a/doc.md", "---\n\u0000\u0001binary\n---\n");
  expect(await readDescriptionUnder(root, "a/doc.md")).toBeNull();
});

test("yields null for a document too large to be a skill doc", async () => {
  // The frontmatter sits in the first lines, so nothing past the ceiling has an
  // answer worth decoding the rest of the file for — and this path runs once per
  // highlighted row, on a name that arrived from the browser.
  await seed("a/doc.md", `---\ndescription: Huge\n---\n${"x".repeat(1024 * 1024)}`);
  expect(await readDescriptionUnder(root, "a/doc.md")).toBeNull();
});

test("refuses a relative path that escapes the root with ..", async () => {
  await writeFile(join(tmp, "outside.md"), "---\ndescription: Outside\n---\n");
  expect(await readDescriptionUnder(root, "../outside.md")).toBeNull();
});

test("refuses a symlink whose target sits outside the root", async () => {
  const outside = join(tmp, "outside.md");
  await writeFile(outside, "---\ndescription: Outside\n---\n");
  await mkdir(join(root, "a"), { recursive: true });
  await symlink(outside, join(root, "a", "doc.md"));
  expect(await readDescriptionUnder(root, "a/doc.md")).toBeNull();
});

test("follows a symlink whose target stays inside the root", async () => {
  // The ordinary dotfiles layout: a skill directory deployed by `ln -s`. Its
  // realpath is still inside the root, so containment lets it through.
  await seed("real/doc.md", "---\ndescription: Inside\n---\n");
  await symlink(join(root, "real"), join(root, "linked"));
  expect(await readDescriptionUnder(root, "linked/doc.md")).toBe("Inside");
});
