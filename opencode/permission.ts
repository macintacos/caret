// OpenCode v2 permission evaluation, for checking a plan file write-back that v2 gives a
// plugin no way to ask about. Copied from anomalyco/opencode at v2.0.18:
// packages/core/src/util/wildcard.ts (match), packages/core/src/permission.ts (evaluate),
// the resource forming in packages/core/src/file-access.ts (resolve), and
// packages/util/src/fs-util.ts (contains, from FSUtil.contains).
//
// Copyright (c) 2025 opencode. MIT License. Permission is hereby granted, free of charge,
// to any person obtaining a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including without limitation
// the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is furnished to do
// so, subject to the following conditions: The above copyright notice and this permission
// notice shall be included in all copies or substantial portions of the Software. THE
// SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
// INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
// PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT
// OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
// OTHER DEALINGS IN THE SOFTWARE.

import path from "node:path";

export type Rule = {
  action: string;
  resource: string;
  effect: "allow" | "deny" | "ask";
};

export type Check = { action: string; resource: string };

export type Location = { directory: string; projectDirectory: string };

/** OpenCode's wildcard match: `*` crosses `/`, and a trailing `" *"` also matches the
 * bare prefix. */
export function wildcardMatch(input: string, pattern: string): boolean {
  const normalized = input.replaceAll("\\", "/");
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");

  if (escaped.endsWith(" .*")) escaped = `${escaped.slice(0, -3)}( .*)?`;

  return new RegExp(`^${escaped}$`, process.platform === "win32" ? "si" : "s").test(normalized);
}

/** The last rule matching both `action` and `resource` wins; no match asks. */
export function evaluate(action: string, resource: string, ...rulesets: (readonly Rule[])[]): Rule {
  return (
    rulesets
      .flat()
      .findLast(
        (rule) => wildcardMatch(action, rule.action) && wildcardMatch(resource, rule.resource),
      ) ?? { action, resource: "*", effect: "ask" }
  );
}

const slash = (value: string) => value.replaceAll("\\", "/");

function contains(parent: string, child: string): boolean {
  const result = path.relative(parent, child);
  return (
    result === "" ||
    (!path.isAbsolute(result) && result !== ".." && !result.startsWith(`..${path.sep}`))
  );
}

/** The checks OpenCode runs before its own tools edit `planFilePath`: a relative `edit`
 * inside the project, else an absolute `edit` plus the file's `external_directory`. */
export function editChecks(planFilePath: string, location: Location): Check[] {
  const absolute = path.resolve(location.directory, planFilePath);
  const worktree = path.resolve(location.projectDirectory);
  const internal =
    contains(location.directory, absolute) ||
    (worktree !== path.parse(worktree).root && contains(worktree, absolute));
  if (internal) {
    return [
      { action: "edit", resource: slash(path.relative(location.directory, absolute) || ".") },
    ];
  }
  // Upstream stats the path to use a directory as its own boundary; a plan file is
  // always a file, so its dirname is the boundary.
  const directory = path.dirname(absolute);
  return [
    { action: "edit", resource: slash(absolute) },
    { action: "external_directory", resource: slash(path.join(directory, "*")) },
  ];
}

/** Whether every check OpenCode would run for editing `planFilePath` is `allow`. Session
 * rules outrank agent rules. */
export function editPermitted(
  planFilePath: string,
  location: Location,
  rules: { agent: readonly Rule[]; session: readonly Rule[] },
): boolean {
  return editChecks(planFilePath, location).every(
    (check) =>
      evaluate(check.action, check.resource, rules.agent, rules.session).effect === "allow",
  );
}
