import { describe, expect, test } from "bun:test";

import { scanFenceLanguages } from "$lib/diffview/languages.ts";

// scanFenceLanguages is the gate between an agent's free-form fence tags and the
// shiki grammar bundle: only canonical, bundled grammar names should reach the
// highlighter, with common aliases normalized and non-code fences dropped.

describe("scanFenceLanguages", () => {
  test("extracts canonical grammar names from fenced blocks", () => {
    const md = "intro\n\n```python\nx = 1\n```\n\n```rust\nfn main() {}\n```\n";
    expect(scanFenceLanguages(md)).toEqual(["python", "rust"]);
  });

  test("normalizes common aliases to their canonical grammar", () => {
    const md = "```js\na\n```\n```sh\nb\n```\n```py\nc\n```\n```yml\nd: 1\n```\n";
    expect(scanFenceLanguages(md)).toEqual(["javascript", "python", "shellscript", "yaml"]);
  });

  test("dedupes repeated and alias-equivalent languages", () => {
    const md = "```bash\na\n```\n```sh\nb\n```\n```shellscript\nc\n```\n";
    expect(scanFenceLanguages(md)).toEqual(["shellscript"]);
  });

  test("drops the markdown grammar, plain text fences, and out-of-bundle tags", () => {
    // `plantuml` is the out-of-bundle case: a real diagram DSL shiki ships no
    // grammar for, so it must be dropped rather than handed to the highlighter.
    const md =
      "```markdown\n# x\n```\n```text\ntree\n```\n```plantuml\n@startuml\n```\n```\nbare\n```\n";
    expect(scanFenceLanguages(md)).toEqual([]);
  });

  test("ignores the info string's trailing tokens (only the language word counts)", () => {
    const md = '```ts title="example.ts"\nconst a = 1;\n```\n';
    expect(scanFenceLanguages(md)).toEqual(["typescript"]);
  });

  test("matches tilde fences and tolerates up to three leading spaces", () => {
    const md = "   ~~~go\npackage main\n~~~\n";
    expect(scanFenceLanguages(md)).toEqual(["go"]);
  });

  test("returns nothing for a plan with no code", () => {
    expect(scanFenceLanguages("# Title\n\nJust prose, no fences.\n")).toEqual([]);
  });
});
