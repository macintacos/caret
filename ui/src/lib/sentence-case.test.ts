import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// caret sets every label and stamp in sentence case. Only a key's legend is capitals,
// because it mirrors the key it names.

const UI_SRC = join(import.meta.dir, "..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(svelte|css|ts)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

/** The selector of each rule that uppercases its text, as `file: selector`. */
function uppercasedRules(): string[] {
  return sources(UI_SRC).flatMap((path) => {
    const text = readFileSync(path, "utf8");
    return [...text.matchAll(/text-transform:\s*uppercase/g)].map((m) => {
      const head = text.slice(0, m.index);
      const open = head.lastIndexOf("{");
      const selector = head
        .slice(head.lastIndexOf("}", open) + 1, open)
        .replace(/\/\*[\s\S]*?\*\//g, "");
      return `${relative(UI_SRC, path)}: ${selector.trim()}`;
    });
  });
}

describe("text case", () => {
  test("nothing but a key's legend is set in capitals", () => {
    expect(uppercasedRules().filter((rule) => !/kbd/.test(rule))).toEqual([]);
  });
});
