import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ROLE_SCOPES, SYNTAX_ROLE_FALLBACKS } from "@/theme/role-scopes.ts";
import {
  parseThemeFile,
  REQUIRED_SYNTAX_ROLES,
  type ThemeMarkdown,
  themeFileJsonSchema,
} from "@/theme/schema.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

const REQUIRED_PALETTE = [
  "paper",
  "raised",
  "sunk",
  "ink",
  "inkSoft",
  "inkFaint",
  "accent",
  "accentBright",
  "accentInk",
  "neutral",
  "ok",
  "danger",
  "attention",
] as const;

const OPTIONAL_HUES = [
  "ruleHue",
  "washHue",
  "markHue",
  "chipBoldHue",
  "chipItalicHue",
  "chipCodeHue",
  "chipLinkHue",
  "chipRefHue",
  "chipSkillHue",
] as const;

type Json = Record<string, unknown>;

function validFile(): Json {
  return {
    $schema: "https://example.com/theme.schema.json",
    id: "my-theme",
    label: "My theme",
    scheme: "dark",
    palette: Object.fromEntries(REQUIRED_PALETTE.map((key) => [key, "#1a2b3c"])),
    syntax: {
      ...Object.fromEntries(REQUIRED_SYNTAX_ROLES.map((role) => [role, { color: "#445566" }])),
      comment: { color: "#778899", fontStyle: ["italic"] },
    },
  };
}

function errorsFor(file: unknown): string[] {
  const result = parseThemeFile(JSON.stringify(file));
  return result.ok ? [] : result.errors;
}

function withField(path: string[], value: unknown): Json {
  const file = validFile();
  let node = file;
  for (const key of path.slice(0, -1)) node = node[key] as Json;
  const last = path[path.length - 1] as string;
  if (value === undefined) delete node[last];
  else node[last] = value;
  return file;
}

describe("parseThemeFile", () => {
  test("accepts a valid file, including $schema", () => {
    const result = parseThemeFile(JSON.stringify(validFile()));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.syntax.comment.fontStyle).toEqual(["italic"]);
  });

  test("fills each optional role a file omits with its fallback role's style", () => {
    const file = validFile();
    file.syntax = Object.fromEntries(
      REQUIRED_SYNTAX_ROLES.map((role, i) => [
        role,
        { color: `#0000${i.toString(16).padStart(2, "0")}` },
      ]),
    );
    const result = parseThemeFile(JSON.stringify(file));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { syntax } = result.file;
    for (const [role, fallback] of Object.entries(SYNTAX_ROLE_FALLBACKS)) {
      expect(syntax[role as keyof typeof syntax]).toEqual(syntax[fallback]);
    }
  });

  test("keeps an optional role's own style", () => {
    const result = parseThemeFile(
      JSON.stringify(withField(["syntax", "operator"], { color: "#123456" })),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.syntax.operator).toEqual({ color: "#123456" });
  });

  test("accepts a slug id", () => {
    expect(errorsFor(withField(["id"], "my-theme-2"))).toEqual([]);
  });

  test.each(["My-theme", "my theme", "-my", "my-", "my--theme", "a".repeat(65)])(
    "rejects id %p",
    (id) => {
      const expected =
        id.length > 64
          ? "id: must be at most 64 characters"
          : "id: must be a lowercase slug of letters, digits, and single dashes, like my-theme";
      expect(errorsFor(withField(["id"], id))).toEqual([expected]);
    },
  );

  test("rejects an empty label", () => {
    expect(errorsFor(withField(["label"], ""))).toEqual(["label: must not be empty"]);
  });

  test("rejects a whitespace-only label", () => {
    expect(errorsFor(withField(["label"], "   "))).toEqual(["label: must not be only whitespace"]);
  });

  test("rejects a 65-character label", () => {
    expect(errorsFor(withField(["label"], "a".repeat(65)))).toEqual([
      "label: must be at most 64 characters",
    ]);
  });

  test("rejects an unknown scheme", () => {
    expect(errorsFor(withField(["scheme"], "dim"))).toEqual(['scheme: must be "light" or "dark"']);
  });

  test("requires scheme", () => {
    expect(errorsFor(withField(["scheme"], undefined))).toEqual(["scheme: is required"]);
  });

  const colorPaths = [
    ...[...REQUIRED_PALETTE, ...OPTIONAL_HUES].map((key) => ["palette", key]),
    ...REQUIRED_SYNTAX_ROLES.map((role) => ["syntax", role, "color"]),
  ];

  for (const path of colorPaths) {
    const dotted = path.join(".");
    test.each(["red", "#fff", "#12345678", "#12345g", "url(x)"])(
      `rejects ${dotted} %p`,
      (color) => {
        expect(errorsFor(withField(path, color))).toEqual([
          `${dotted}: must be a hex color like #1a2b3c`,
        ]);
      },
    );

    test(`accepts upper-case hex at ${dotted}`, () => {
      expect(errorsFor(withField(path, "#ABCDEF"))).toEqual([]);
    });
  }

  test("rejects an unknown fontStyle item", () => {
    expect(errorsFor(withField(["syntax", "comment", "fontStyle"], ["wavy"]))).toEqual([
      "syntax.comment.fontStyle[0]: must be one of italic, bold, underline, strikethrough",
    ]);
  });

  test("rejects a bare-string fontStyle", () => {
    expect(errorsFor(withField(["syntax", "comment", "fontStyle"], "italic"))).toEqual([
      "syntax.comment.fontStyle: must be an array",
    ]);
  });

  test("accepts combined font styles", () => {
    expect(errorsFor(withField(["syntax", "comment", "fontStyle"], ["bold", "italic"]))).toEqual(
      [],
    );
  });

  test.each([...REQUIRED_SYNTAX_ROLES])("requires syntax.%s", (role) => {
    expect(errorsFor(withField(["syntax", role], undefined))).toEqual([
      `syntax.${role}: is required`,
    ]);
  });

  test.each([...REQUIRED_PALETTE])("requires palette.%s", (key) => {
    expect(errorsFor(withField(["palette", key], undefined))).toEqual([
      `palette.${key}: is required`,
    ]);
  });

  test.each([...OPTIONAL_HUES])("accepts palette.%s when present", (key) => {
    expect(errorsFor(withField(["palette", key], "#123456"))).toEqual([]);
  });

  test("reports a wrong type in user wording", () => {
    expect(errorsFor(withField(["label"], 7))).toEqual(["label: must be a string"]);
  });

  test.each([
    [[], "pallete"],
    [["palette"], "palette.pallete"],
    [["syntax"], "syntax.pallete"],
    [["syntax", "comment"], "syntax.comment.pallete"],
  ])("rejects an unknown key under %p", (parent, path) => {
    expect(errorsFor(withField([...parent, "pallete"], "x"))).toEqual([
      `${path}: is not a theme file field`,
    ]);
  });

  test("reports one line per failure", () => {
    const file = withField(["id"], "Bad");
    delete (file.palette as Json).ok;
    (file as Json).extra = 1;
    expect(errorsFor(file).sort()).toEqual(
      [
        "id: must be a lowercase slug of letters, digits, and single dashes, like my-theme",
        "palette.ok: is required",
        "extra: is not a theme file field",
      ].sort(),
    );
  });

  describe("markdown styles", () => {
    const MARKDOWN: ThemeMarkdown = {
      heading: { color: "#bd93f9", fontStyle: ["bold"] },
      heading1: { color: "#ff79c6", fontStyle: ["bold", "underline"] },
      heading2: { color: "#ffb86c" },
      heading3: { color: "#f1fa8c", fontStyle: ["italic"] },
      heading4: { color: "#50fa7b" },
      heading5: { color: "#8be9fd" },
      heading6: { color: "#6272a4" },
      code: { color: "#50fa7b" },
      link: { color: "#ff79c6" },
      bold: { color: "#ffb86c" },
      italic: { color: "#f1fa8c" },
      listMarker: { color: "#8be9fd" },
      quote: { color: "#f1fa8c", fontStyle: ["italic"] },
    };

    test("accepts a style for every element", () => {
      const result = parseThemeFile(JSON.stringify({ ...validFile(), markdown: MARKDOWN }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.file.markdown).toEqual(MARKDOWN);
    });

    test("accepts a subset of elements", () => {
      expect(errorsFor({ ...validFile(), markdown: { link: { color: "#ff79c6" } } })).toEqual([]);
    });

    test("rejects an element caret does not style", () => {
      expect(errorsFor({ ...validFile(), markdown: { headline: { color: "#bd93f9" } } })).toEqual([
        "markdown.headline: is not a theme file field",
      ]);
    });

    test("rejects a malformed color", () => {
      expect(errorsFor({ ...validFile(), markdown: { link: { color: "pink" } } })).toEqual([
        "markdown.link.color: must be a hex color like #1a2b3c",
      ]);
    });

    test("rejects an unknown fontStyle item", () => {
      const quote = { color: "#f1fa8c", fontStyle: ["oblique"] };
      expect(errorsFor({ ...validFile(), markdown: { quote } })).toEqual([
        "markdown.quote.fontStyle[0]: must be one of italic, bold, underline, strikethrough",
      ]);
    });
  });

  test("reports malformed JSON as one error", () => {
    const result = parseThemeFile("{ nope");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.startsWith("theme file: is not valid JSON (")).toBe(true);
    }
  });
});

describe("themeFileJsonSchema", () => {
  test("is a draft-7 schema of the input side", () => {
    const schema = themeFileJsonSchema();
    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(schema.required).toEqual(["id", "label", "scheme", "palette", "syntax"]);
  });

  test("requires every required syntax role and rejects unknown top-level keys", () => {
    const schema = themeFileJsonSchema();
    const syntax = schema.properties?.syntax as { required?: string[] };
    expect([...(syntax.required ?? [])].sort()).toEqual([...REQUIRED_SYNTAX_ROLES].sort());
    expect(schema.additionalProperties).toBe(false);
  });

  test("matches the committed doc/theme.schema.json", () => {
    const committed: unknown = JSON.parse(
      readFileSync(join(REPO_ROOT, "doc/theme.schema.json"), "utf8"),
    );
    expect(
      committed,
      "doc/theme.schema.json is stale: run `bun scripts/generate-theme-schema.ts && mise run format`",
    ).toEqual(themeFileJsonSchema());
  });
});

describe("doc/CONFIGURING.md", () => {
  test("its example theme file is valid and is caret-dark", () => {
    const doc = readFileSync(join(REPO_ROOT, "doc/CONFIGURING.md"), "utf8");
    const section = doc.split("\n## Theme files\n")[1]?.split("\n## ")[0] ?? "";
    const exampleJson = section.match(/```json\n([\s\S]*?)\n```/)?.[1] ?? "";
    expect(parseThemeFile(exampleJson).ok).toBe(true);
    const example = JSON.parse(exampleJson);
    delete example.$schema;
    expect(example).toEqual(
      JSON.parse(readFileSync(join(REPO_ROOT, "ui/src/lib/themes/caret-dark.json"), "utf8")),
    );
  });

  test("its syntax tables list every role with its scopes and fallback", () => {
    const doc = readFileSync(join(REPO_ROOT, "doc/CONFIGURING.md"), "utf8");
    const section = doc.split("\n### `syntax`\n")[1]?.split("\n### ")[0] ?? "";
    const codeSpan = (s: string) => `\`${s}\``;
    const fallbacks: Record<string, string> = SYNTAX_ROLE_FALLBACKS;
    const documented = section
      .split("\n")
      .filter((line) => line.startsWith("| `"))
      .map((line) => line.split("|").map((cell) => cell.trim()))
      .map(([, role, , ...rest]) => [role, rest.filter(Boolean).join(" | ")]);
    const expected = Object.entries(ROLE_SCOPES).map(([role, scopes]) => [
      codeSpan(role),
      [
        scopes.map(codeSpan).join(", "),
        ...(role in fallbacks ? [codeSpan(fallbacks[role] ?? "")] : []),
      ].join(" | "),
    ]);
    expect(Object.fromEntries(documented)).toEqual(Object.fromEntries(expected));
  });
});
