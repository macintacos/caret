// Locate caret's shipped OpenCode packaging (the plugin source + command files)
// for the install subcommand. The packaging lives at <caret-root>/opencode/ in
// every distribution that supports OpenCode install: the local dev build
// (`caret install --from-local`) and the npm/github bundle (package.json `files`
// ships opencode/). Root resolution uses argv[1]/execPath — the same signals build-id.ts
// keys off — so it is depth-independent (works whether this module runs from
// source, the bundle, or the compiled binary).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** caret's root dir (the one containing opencode/ and bin/). dev/bundle: argv[1]
 * is the entry script (src/cli.ts or dist/cli.js), one level under root. binary:
 * argv[1] is a subcommand, so the compiled binary at root/bin/caret-native (=
 * execPath) is two levels under root. Each candidate is confirmed by the presence
 * of opencode/caret.plugin.ts before it's accepted. */
export function resolveCaretRoot(): string {
  const candidates: string[] = [];
  const script = process.argv[1];
  if (script) candidates.push(join(dirname(script), ".."));
  candidates.push(join(dirname(process.execPath), ".."));
  for (const root of candidates) {
    if (existsSync(join(root, "opencode", "caret.plugin.ts"))) return root;
  }
  throw new Error(
    `caret OpenCode packaging not found (no opencode/caret.plugin.ts under: ${candidates.join(", ") || "(none)"}). The OpenCode plugin source must ship with caret.`,
  );
}

export interface OpencodePackaging {
  /** The caret shim the deployed command files invoke (their `__CARET_BIN__`). */
  binPath: string;
  /** Command files (basename + contents) from opencode/commands/, if any. */
  commands: { name: string; contents: string }[];
}

/** Read caret's OpenCode packaging from the resolved root. */
export function loadOpencodePackaging(root: string = resolveCaretRoot()): OpencodePackaging {
  const binPath = join(root, "bin", "caret");
  const commandsDir = join(root, "opencode", "commands");
  let commands: { name: string; contents: string }[] = [];
  try {
    commands = readdirSync(commandsDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => ({ name: f, contents: readFileSync(join(commandsDir, f), "utf-8") }));
  } catch {
    // No command files shipped (or unreadable) — the array entry alone is a valid install.
    commands = [];
  }
  return { binPath, commands };
}
