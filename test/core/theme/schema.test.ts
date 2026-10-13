import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  fillFallbackRoles,
  parseThemeFile,
  SYNTAX_ROLES,
  themeFileJsonSchema,
} from "@/theme/schema.ts";

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
      ...Object.fromEntries(SYNTAX_ROLES.map((role) => [role, { color: "#445566" }])),
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

  test("rejects a 65-character label", () => {
    expect(errorsFor(withField(["label"], "a".repeat(65)))).toEqual([
      "label: must be at most 64 characters",
    ]);
  });

  test("rejects an unknown scheme", () => {
    expect(errorsFor(withField(["scheme"], "dim"))).toEqual(['scheme: must be "light" or "dark"']);
  });

  const colorPaths = [
    ...[...REQUIRED_PALETTE, ...OPTIONAL_HUES].map((key) => ["palette", key]),
    ...SYNTAX_ROLES.map((role) => ["syntax", role, "color"]),
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

  test.each([...SYNTAX_ROLES])("requires syntax.%s", (role) => {
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

  test("reports malformed JSON as one error", () => {
    const result = parseThemeFile("{ nope");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.startsWith("theme file: is not valid JSON (")).toBe(true);
    }
  });
});

describe("fillFallbackRoles", () => {
  const fallbacks = { tag: "keyword" } as const;
  const keyword = { color: "#111111", fontStyle: ["bold" as const] };

  test("gives an absent optional role its fallback's style", () => {
    expect(fillFallbackRoles({ keyword }, fallbacks)).toEqual({ keyword, tag: keyword });
  });

  test("keeps a present optional role's own style", () => {
    const tag = { color: "#222222" };
    expect(fillFallbackRoles({ keyword, tag }, fallbacks)).toEqual({ keyword, tag });
  });
});

describe("themeFileJsonSchema", () => {
  test("is a draft-7 schema of the input side", () => {
    const schema = themeFileJsonSchema();
    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(schema.required).toEqual(["id", "label", "scheme", "palette", "syntax"]);
  });

  test("requires every syntax role and rejects unknown top-level keys", () => {
    const schema = themeFileJsonSchema();
    const syntax = schema.properties?.syntax as { required?: string[] };
    expect([...(syntax.required ?? [])].sort()).toEqual([...SYNTAX_ROLES].sort());
    expect(schema.additionalProperties).toBe(false);
  });

  test("matches the committed doc/theme.schema.json", () => {
    const committed: unknown = JSON.parse(
      readFileSync(join(import.meta.dir, "../../../doc/theme.schema.json"), "utf8"),
    );
    expect(
      committed,
      "doc/theme.schema.json is stale: run `bun scripts/generate-theme-schema.ts && mise run format`",
    ).toEqual(themeFileJsonSchema());
  });
});
