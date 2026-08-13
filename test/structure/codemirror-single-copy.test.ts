// Standing gate for the CodeMirror single-copy invariant (EXC-1076). The five
// @codemirror/* packages the annotation editor is built on are peers of one
// another, and the extension system they implement is identity-based: facets,
// StateFields and decorations are keyed by the object identity of the class that
// declared them. Two copies of @codemirror/state in one tree therefore give the
// editor two distinct EditorState identities, and the symptom is an extension
// that silently does nothing rather than an error naming a version — which is
// why this is a gate and not a comment.
//
// The invariant is a standing one because the obvious way to move these packages
// reintroduces the duplicate. `bun update <names>` re-resolves only the named
// root edges; a transitive consumer whose lock entry already resolves
// @codemirror/state stays on it, because its own `^6.0.0` range is still
// satisfied and bun never re-resolves a satisfied edge. The old copy is then
// nested under every such consumer — @codemirror/autocomplete (reached through
// @codemirror/lang-markdown) and the whole @codemirror/lang-* grammar set
// (reached through @codemirror/language-data) — and under bun's isolated linker
// both copies exist on disk at once. In a diff that reads as ordinary lockfile
// churn, which is what makes it worth failing `bun test` over.
//
// To move the set without splitting it: add a temporary `overrides` block to
// package.json naming each @codemirror/* package at its target version, run
// `bun install` so every edge resolves to it, then delete the block and run
// `bun install` again. The resolutions stay put — every edge is satisfied and
// every range still admits them — so the manifest ends byte-identical and only
// bun.lock moves. bun offers no dedupe command, so this is the mechanism.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type ParseError, parse as parseJsonc } from "jsonc-parser";

// The suite sits at test/structure/, two levels below the repo root; resolving
// against import.meta.dir reads the real tree regardless of the runner's cwd.
const REPO_ROOT = join(import.meta.dir, "..", "..");

/** bun.lock is JSONC — unquoted-safe keys and trailing commas — so it needs a
 * tolerant parser rather than `JSON.parse`. Each `packages` value is a tuple
 * whose first element is the resolved `<name>@<version>` id. */
interface BunLock {
  packages: Record<string, [string, ...unknown[]]>;
}

const errors: ParseError[] = [];
const lock = parseJsonc(readFileSync(join(REPO_ROOT, "bun.lock"), "utf8"), errors, {
  allowTrailingComma: true,
}) as BunLock;

/** Resolved versions per `@codemirror/*` package name, across every entry in the
 * lock — top-level and nested alike, since a nested entry is exactly how the
 * second copy arrives. Scoped names carry their own `/` and a leading `@`, so
 * the split is on the LAST `@` rather than the first. */
const versionsByName = new Map<string, Set<string>>();
for (const [id] of Object.values(lock.packages)) {
  const at = id.lastIndexOf("@");
  const name = id.slice(0, at);
  if (!name.startsWith("@codemirror/")) continue;
  const versions = versionsByName.get(name) ?? new Set<string>();
  versions.add(id.slice(at + 1));
  versionsByName.set(name, versions);
}

test("bun.lock parses as JSONC", () => {
  expect(errors).toEqual([]);
});

test("every @codemirror package resolves to exactly one version", () => {
  const duplicated = [...versionsByName]
    .filter(([, versions]) => versions.size > 1)
    .map(([name, versions]) => `${name}: ${[...versions].sort().join(", ")}`)
    .sort();
  expect(duplicated).toEqual([]);
});

test("the lock still carries @codemirror packages to check", () => {
  // Without this the gate passes vacuously if the editor is swapped out or the
  // packages are renamed upstream — finding nothing would read as finding no
  // duplicates.
  expect(versionsByName.size).toBeGreaterThan(0);
});
