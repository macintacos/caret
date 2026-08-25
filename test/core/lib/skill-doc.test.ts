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

test("ends a block scalar at the next key, not at the end of the block", async () => {
  await seed("a/doc.md", "---\ndescription: >\n  Use when planning\nname: a\n---\n");
  expect(await readDescriptionUnder(root, "a/doc.md")).toBe("Use when planning");
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

test("yields null for a binary blob rather than throwing", async () => {
  await seed("a/doc.md", "\u0000\u0001binary");
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
