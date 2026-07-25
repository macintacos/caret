// Standing gate for the import-convention invariant (EXC-879). Every root the
// test layer reaches now has an alias (@test, @scripts, @opencode, @ui,
// @root/package.json), so a `../` dance is no longer the only way to address a
// cross-directory target — it is drift. `doc/agents/typescript-rules.md` states
// the rule; this suite is what makes it falsifiable, so a reintroduced `../`
// fails `bun test` (and preflight) on the push that adds it rather than being
// caught by a one-time grep at review time.
//
// The rule: under test/ and ui/src/, no import specifier may start with `../`,
// and a `./` specifier may only name a sibling in the same directory — never
// descend into a subdirectory. Same-directory `./x` stays legal because it is
// the idiomatic barrel form and carries no path arithmetic to get wrong.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The suite sits at test/structure/, two levels below the repo root; resolving
// against import.meta.dir reads the real tree regardless of the runner's cwd.
const REPO_ROOT = join(import.meta.dir, "..", "..");

// The two source roots this invariant governs. `.ts` only: the `.svelte` bodies
// under ui/src are vendored or already same-directory, and svelte-check rather
// than bun owns them.
const ROOTS = ["test", "ui/src"];

// shadcn-svelte components are copied verbatim from the registry and re-synced
// with `shadcn-svelte add`. Their barrels address siblings as `./x.svelte`,
// which the rule already permits — but policing this directory would put our
// gate in the way of the next re-copy, so it is excluded for the same reason
// biome.jsonc excludes it from lint/format.
const EXCLUDED_DIRS = ["ui/src/lib/components/ui"];

// generate-ui-manifest.test.ts asserts the *text* the manifest generator emits,
// and the generated file (src/ui-manifest.generated.ts) imports built UI assets
// by relative path. Those specifiers live inside string literals in the
// assertion, not in the suite's own import graph, so they are expected output
// rather than drift. Allowlisted by exact prefix so a genuine bad import
// elsewhere in the same file still fails.
const ALLOWED_LITERALS: Record<string, string> = {
  "test/scripts/generate-ui-manifest.test.ts": "../ui/dist/",
};

/**
 * Extracts every relative import specifier in `source` that violates the rule.
 *
 * Covers all three specifier-bearing forms: `from "…"` (which also catches
 * `export … from`), a bare side-effect `import "…"`, and a dynamic
 * `import("…")`. All three are real module references, so a rule that only read
 * the `from` form would leave the ~80 side-effect harness imports unpoliced. A
 * specifier offends when it starts with `../` (any upward traversal) or when it
 * starts with `./` and contains a further `/` (a descent into a subdirectory).
 *
 * The `(?<!@)` guard drops CSS at-rules: `@import "./styles/x.css"` is not a JS
 * module reference, and appCss.ts documents the partials it inlines in exactly
 * that form. Scanning raw source rather than stripping comments first is
 * deliberate — a tokenizer that mis-parses a regex literal containing a quote
 * would silently stop reporting real imports, and for a gate a loud false
 * positive (reword the prose) beats a silent false negative.
 */
function offendingSpecifiers(source: string, allowedPrefix?: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/(?<!@)\b(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
    const spec = match[1];
    if (!spec) continue;
    if (!spec.startsWith("./") && !spec.startsWith("../")) continue;
    if (allowedPrefix && spec.startsWith(allowedPrefix)) continue;
    const descends = spec.startsWith("./") && spec.slice(2).includes("/");
    if (spec.startsWith("../") || descends) found.push(spec);
  }
  return found;
}

test("no import under test/ or ui/src/ traverses up or descends via a relative path", () => {
  const glob = new Bun.Glob("**/*.ts");
  const violations: string[] = [];

  for (const root of ROOTS) {
    for (const found of glob.scanSync({ cwd: join(REPO_ROOT, root) })) {
      const repoPath = `${root}/${found}`;
      if (EXCLUDED_DIRS.some((dir) => repoPath.startsWith(`${dir}/`))) continue;
      const source = readFileSync(join(REPO_ROOT, repoPath), "utf-8");
      for (const spec of offendingSpecifiers(source, ALLOWED_LITERALS[repoPath])) {
        violations.push(`${repoPath}: ${spec}`);
      }
    }
  }

  expect(violations).toEqual([]);
});

// The fixtures below are assembled from UP rather than written as literal
// specifiers, and wrapped by the helpers rather than spelled inline. Both keep
// this suite's own source free of any quoted `..`-prefixed string, so the walk
// above never reports the file that defines the rule — and a mechanical
// import-rewrite pass can't mistake a negative-case fixture for a real import.
const UP = "..";
const probe = (specifier: string) => `from "${specifier}"`;
const sideEffect = (specifier: string) => `import "${specifier}";`;
const dynamic = (specifier: string) => `await import("${specifier}")`;

test("the rule permits a same-directory sibling and rejects a subdirectory descent", () => {
  expect(offendingSpecifiers(probe("./poll.ts"))).toEqual([]);
  expect(offendingSpecifiers(probe("./support/poll.ts"))).toEqual(["./support/poll.ts"]);
  expect(offendingSpecifiers(probe(`${UP}/support/poll.ts`))).toEqual([`${UP}/support/poll.ts`]);
  expect(offendingSpecifiers(probe(`${UP}/${UP}/package.json`))).toEqual([
    `${UP}/${UP}/package.json`,
  ]);
  expect(offendingSpecifiers(probe("@test/support/poll.ts"))).toEqual([]);
});

test("the rule reads side-effect and dynamic imports, not just the from form", () => {
  expect(offendingSpecifiers(sideEffect(`${UP}/${UP}/test-setup.ts`))).toEqual([
    `${UP}/${UP}/test-setup.ts`,
  ]);
  expect(offendingSpecifiers(dynamic(`${UP}/${UP}/opencode/index.ts`))).toEqual([
    `${UP}/${UP}/opencode/index.ts`,
  ]);
  expect(offendingSpecifiers(sideEffect("@ui/test-setup.ts"))).toEqual([]);
});
