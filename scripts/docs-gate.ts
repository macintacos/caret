#!/usr/bin/env bun
// Reads a pull request's changed paths on stdin and fails when one is user-visible
// but no page the docs site publishes changed. Run by .github/workflows/docs-gate.yml.

import { join } from "node:path";

import { parse as parseToml } from "smol-toml";
import { z } from "zod";

export const SKIP_LABEL = "docs-not-needed";

/** What a user sees, and the paths that define it. Keep in sync with
 * docs/agents/documentation-rules.md § The docs gate. */
export const USER_VISIBLE: readonly { surface: string; globs: readonly string[] }[] = [
  {
    surface: "CLI commands, flags, help text, and output",
    globs: ["src/cli.ts", "src/commands/**"],
  },
  { surface: "what caret install sets up in an agent host", globs: ["src/adapters/*/install.ts"] },
  { surface: "config keys, defaults, and CARET_* variables", globs: ["src/config/**"] },
  { surface: "the review page", globs: ["ui/src/**"] },
  {
    surface: "the /caret command and the host plugins",
    globs: ["skills/**", "opencode/**", "pi/**", "mod/hooks/**"],
  },
  { surface: "theme files", globs: ["src/theme/**"] },
  { surface: "plan formatting and file previews", globs: ["src/plan/**"] },
  { surface: "diagnostics", globs: ["src/doctor/**"] },
  { surface: "the background service", globs: ["src/service/**"] },
];

const TEST_FILE = new Bun.Glob("**/*.test.ts");

const ZensicalToml = z.object({ project: z.object({ exclude_docs: z.string() }) });

/** The surface `path` changes, or null when it is a test file or no surface's. */
export function userVisibleSurface(path: string): string | null {
  if (TEST_FILE.match(path)) return null;
  return (
    USER_VISIBLE.find(({ globs }) => globs.some((glob) => new Bun.Glob(glob).match(path)))
      ?.surface ?? null
  );
}

/** True for a path zensical.toml's exclude_docs keeps off the site. Reads only the
 * anchored `/dir/` and `/file` forms and throws on any other pattern. */
export function excludedFromSite(zensicalToml: string): (path: string) => boolean {
  const patterns = ZensicalToml.parse(parseToml(zensicalToml))
    .project.exclude_docs.split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const matchers = patterns.map((pattern): ((path: string) => boolean) => {
    if (!pattern.startsWith("/") || /[*?[!]/.test(pattern)) {
      throw new Error(
        `zensical.toml exclude_docs pattern "${pattern}" is not one the docs gate reads; teach scripts/docs-gate.ts to read it.`,
      );
    }
    const target = `docs${pattern}`;
    return pattern.endsWith("/") ? (path) => path.startsWith(target) : (path) => path === target;
  });

  return (path) => matchers.some((matches) => matches(path));
}

/** The gate's failure message, or null when the pull request passes. */
export function docsGateReport(
  changed: readonly string[],
  labels: readonly string[],
  excluded: (path: string) => boolean,
): string | null {
  if (changed.length === 0)
    return "read no changed paths; a pull request always changes at least one.";
  if (labels.includes(SKIP_LABEL)) return null;

  const visible = changed.flatMap((path) => {
    const surface = userVisibleSurface(path);
    return surface === null ? [] : [`${path} (${surface})`];
  });
  if (visible.length === 0) return null;

  if (changed.some((path) => path.startsWith("docs/") && path.endsWith(".md") && !excluded(path)))
    return null;

  return `${visible.join(", ")} changed, but no page the docs site publishes did. Update the page that describes it (docs/agents/references/site.md says which), or add the docs-not-needed label if every page is still accurate.`;
}

if (import.meta.main) {
  const changed = (await Bun.stdin.text())
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const labels = z.array(z.string()).parse(JSON.parse(process.env.PR_LABELS ?? "[]"));
  const excluded = excludedFromSite(
    await Bun.file(join(import.meta.dir, "..", "zensical.toml")).text(),
  );

  const report = docsGateReport(changed, labels, excluded);
  if (report !== null) {
    console.log(`::error::docs gate: ${report}`);
    process.exitCode = 1;
  }
}
