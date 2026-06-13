import { describe, expect, test } from "bun:test";
import { bundledLanguages, bundledThemes } from "./shiki-bundle.ts";

// The scoped shiki bundle is what keeps the UI build from pulling shiki's full
// ~300-grammar barrel into the embedded asset (vite code-splits every loader in
// bundledLanguages). This suite pins the grammar set to markdown plus the
// grammars caret's highlight pipeline loads for fenced code; a grammar added or
// dropped here changes the build's payload, so the drift fails the unit suite
// instead of silently bloating the binary.

// markdown is the plan source language; the rest are the fenced-code grammars
// caret scans for and attaches so embedded code blocks highlight (see
// languages.ts). Keep this list in sync with bundledLanguages.
const EXPECTED_LANGS = [
  "markdown",
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "jsonc",
  "yaml",
  "toml",
  "shellscript",
  "diff",
  "python",
  "rust",
  "go",
  "sql",
  "css",
  "scss",
  "html",
  "xml",
  "java",
  "c",
  "cpp",
  "ruby",
  "php",
  "dockerfile",
  "graphql",
] as const;

describe("the scoped shiki bundle", () => {
  test("bundledLanguages is exactly the markdown + fenced-code grammar set", () => {
    expect(Object.keys(bundledLanguages).sort()).toEqual([...EXPECTED_LANGS].sort());
  });

  test("each grammar is a lazy loader, so vite emits one on-demand chunk per grammar", () => {
    for (const loader of Object.values(bundledLanguages)) {
      expect(typeof loader).toBe("function");
    }
  });

  test("bundledThemes is empty — caret renders only its own registered themes", () => {
    expect(Object.keys(bundledThemes)).toEqual([]);
  });
});
