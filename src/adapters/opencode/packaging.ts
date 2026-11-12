// Locate caret's shipped OpenCode packaging (the plugin source, command and reference files)
// for the install subcommand. The packaging lives at <caret-root>/opencode/ in
// every distribution that supports OpenCode install: the local dev build
// (`caret install --from-local`) and the npm/github bundle (package.json `files`
// ships opencode/). Root resolution uses argv[1]/execPath — the same signals build-id.ts
// keys off — so it is depth-independent (works whether this module runs from
// source, the bundle, or the compiled binary).

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { isCaretCheckout } from "@/adapters/opencode/entries.ts";

/** caret's root dir (the one containing opencode/ and bin/). dev/bundle: argv[1]
 * is the entry script (src/cli.ts or dist/cli.js), one level under root. binary:
 * argv[1] is a subcommand, so the compiled binary at root/bin/caret-native (=
 * execPath) is two levels under root. Each candidate is confirmed as a caret checkout
 * (`isCaretCheckout`) before it's accepted. */
export function resolveCaretRoot(): string {
  const candidates: string[] = [];
  const script = process.argv[1];
  if (script) candidates.push(join(dirname(script), ".."));
  candidates.push(join(dirname(process.execPath), ".."));
  for (const root of candidates) {
    if (isCaretCheckout(root)) return root;
  }
  throw new Error(
    `caret OpenCode packaging not found (no opencode/caret.plugin.ts under: ${candidates.join(", ") || "(none)"}). The OpenCode plugin source must ship with caret.`,
  );
}

/** The demo plan template, relative to caret's root. */
export const DEMO_TEMPLATE = "templates/demo.md";

export interface OpencodePackaging {
  /** The caret shim the deployed files invoke (their `__CARET_BIN__`). */
  binPath: string;
  /** The demo template's contents — what the deployed files' `__CARET_DEMO_TEMPLATE__` becomes. */
  demoTemplate: string;
  /** Command files (basename + contents) from opencode/commands/, if any. */
  commands: PackagedFile[];
  /** The files the command loads by argument, from opencode/references/, if any. */
  references: PackagedFile[];
}

/** One packaged Markdown file: its basename and raw, unrendered contents. */
export type PackagedFile = { name: string; contents: string };

/** Read caret's OpenCode packaging from the resolved root. */
export function loadOpencodePackaging(root: string = resolveCaretRoot()): OpencodePackaging {
  const binPath = join(root, "bin", "caret");
  const demoTemplate = readFileSync(join(root, DEMO_TEMPLATE), "utf-8");
  return {
    binPath,
    demoTemplate,
    commands: readMarkdownFiles(join(root, "opencode", "commands")),
    references: readMarkdownFiles(join(root, "opencode", "references")),
  };
}

/** Every `.md` file in `dir`, sorted by name; none when the dir is absent or unreadable.
 * An absent `commands/` is fine: the array entry alone is a valid install. */
function readMarkdownFiles(dir: string): PackagedFile[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => ({ name: f, contents: readFileSync(join(dir, f), "utf-8") }));
  } catch {
    return [];
  }
}
