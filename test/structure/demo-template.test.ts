import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const { files } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as {
  files: string[];
};
const ships = (rel: string) =>
  files.some((f) => rel === f || (f.endsWith("/") && rel.startsWith(f)));

// Claude Code installs the npm package as the plugin root, and OpenCode's command
// files resolve against the same package, so a path a demo command reads must ship.
for (const [command, prefix] of [
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code's variable, written literally
  ["commands/demo.md", "${CLAUDE_PLUGIN_ROOT}/"],
  ["opencode/commands/demo.md", "__CARET_ROOT__/"],
] as const) {
  test(`${command} reads only files the package ships`, () => {
    const text = readFileSync(join(ROOT, command), "utf-8");
    const paths = text
      .split(prefix)
      .slice(1)
      .map((s) => s.match(/^[\w./-]+/)?.[0] ?? "");
    expect(paths.length).toBeGreaterThan(0);
    for (const rel of paths) {
      expect(existsSync(join(ROOT, rel))).toBe(true);
      expect(ships(rel)).toBe(true);
    }
  });
}
