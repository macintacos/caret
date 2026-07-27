import { describe, expect, test } from "bun:test";

import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import { AUTHORED_SHIKI_THEMES } from "$lib/authored-shiki.ts";
import { CARET_SHIKI_THEMES, shikiThemeFor, shikiThemeForPalette } from "$lib/caret-theme.ts";
import { type ColorToken, THEME_IDS, THEMES, type Theme, type ThemeId } from "$lib/theme.ts";
import { CARET_COLOR_PLACEMENT, CARET_DARK, CARET_LIGHT } from "$lib/themes/caret.ts";
import { UPSTREAM_SHIKI_THEMES } from "$lib/upstream-shiki.ts";

// caret-theme.ts resolves one shiki theme per registered palette, two ways. A
// vendor palette resolves to that vendor's own published theme (EXC-896); caret's
// pair, which has no upstream theme, is DERIVED from the THEMES color tokens in
// theme.ts (EXC-730) — the single source of truth for every color the UI paints.
// shiki resolves token colors at highlight time and can't read CSS custom
// properties, so the hex is read out of THEMES at module load.
//
// These tests pin both halves: the derivation emits exactly the seven mapped
// tokens and nothing else, so renaming or dropping a token (or leaking a stray
// color in) fails here; and a vendor palette carries its upstream rule set with
// caret's two fence overrides appended last.

// Each Palette field maps to one THEMES custom property (the mapping
// caret-theme.ts's paletteFromTheme performs).
const FIELD_TO_TOKEN: Record<string, ColorToken> = {
  bg: "--paper-sunk",
  fg: "--ink",
  comment: "--ink-faint",
  punctuation: "--ink-soft",
  keyword: "--accent",
  entity: "--accent-bright",
  string: "--ok",
};

/** The palettes that name an upstream theme, paired with the id they name — and
 * the ones that name none, which keep the derivation. */
const VENDOR_PALETTES = THEME_IDS.flatMap((id) => {
  const shikiTheme = THEMES[id].shikiTheme;
  return shikiTheme ? [{ id, shikiTheme }] : [];
});
const DERIVED_IDS = THEME_IDS.filter((id) => THEMES[id].shikiTheme === undefined);

/** How many rules caret appends over an upstream theme — the two EXC-692 fence rules
 * plus the inline-code backtick (caret-theme.ts's `structuralMarkerRules`). */
const STRUCTURAL_RULES = 3;

/** The scopes those three rules own, in the order the resolver appends them. */
const STRUCTURAL_SCOPES = [
  "markup.fenced_code.block.markdown punctuation.definition.markdown",
  "fenced_code.block.language",
  "punctuation.definition.raw.markdown",
];

/** The half of the named color set nothing but the highlighter spends (EXC-902).
 * Read off the placement map rather than re-listed, so a color reclassified there
 * changes what the authored themes are held to. */
const SHIKI_ONLY = Object.entries(CARET_COLOR_PLACEMENT)
  .filter(([, placement]) => placement === "shiki-only")
  .map(([color]) => color as keyof typeof CARET_DARK);

/** The expected color for each Palette field, sourced from a theme's tokens. The
 * ColorToken-keyed tokens map guarantees each lookup resolves. */
function expectedPalette(id: ThemeId): Record<string, string> {
  const tokens = THEMES[id].tokens;
  const palette: Record<string, string> = {};
  for (const [field, token] of Object.entries(FIELD_TO_TOKEN)) {
    palette[field] = tokens[token];
  }
  return palette;
}

interface ThemeLike {
  colors?: Record<string, string | undefined>;
  settings?: Array<{ settings?: { foreground?: string } }>;
}

/** Every distinct foreground color the theme actually emits. */
function themeColors(theme: ThemeLike): Set<string> {
  const colors = new Set<string>();
  for (const v of Object.values(theme.colors ?? {})) if (v) colors.add(v);
  for (const rule of theme.settings ?? []) {
    const fg = rule.settings?.foreground;
    if (fg) colors.add(fg);
  }
  return colors;
}

// EXC-896: a vendor palette names that vendor's published shiki theme, so picking
// Dracula highlights code in real Dracula rather than in caret's seven-role
// derivation wearing Dracula's hues. caret's own pair names none — there is no
// upstream theme to point at, so they keep the derivation.
describe("upstream shiki theme declarations", () => {
  test("every registry key is that theme's own upstream name", () => {
    for (const [id, theme] of Object.entries(UPSTREAM_SHIKI_THEMES)) {
      // A mis-wired import (`dracula: githubDarkDefault`) would otherwise render
      // the wrong theme with nothing to catch it.
      expect(theme.name, id).toBe(id);
    }
  });

  test("every palette either names an upstream theme or is one of caret's own", () => {
    // Pinned rather than merely counted: a new palette has to make a deliberate
    // choice instead of silently falling through to the derivation. That a named id
    // resolves to a registered theme needs no assertion — `shikiTheme` is typed
    // `keyof typeof UPSTREAM_SHIKI_THEMES`, so an unregistered id cannot compile.
    expect(DERIVED_IDS).toEqual(["caret-dark", "caret-light"]);
  });

  // GitHub publishes two pairs. The unsuffixed `github-light` / `github-dark` are
  // the legacy Primer themes (dark background #24292e); caret's GitHub palettes are
  // built from current Primer, which matches the `-default` pair (#0d1117). The key
  // union catches a nonexistent id but not a valid-yet-wrong-vintage one, so pin the
  // choice by value.
  test("the GitHub palettes name current Primer, not the legacy pair", () => {
    expect(THEMES["github-dark"].shikiTheme).toBe("github-dark-default");
    expect(THEMES["github-light"].shikiTheme).toBe("github-light-default");
    expect(UPSTREAM_SHIKI_THEMES["github-dark-default"].colors?.["editor.background"]).toBe(
      "#0d1117",
    );
  });
});

// EXC-903: caret's own pair has no vendor to point at, so it AUTHORS its two themes
// from the named color set in themes/caret.ts (EXC-902) — the eleven shiki-only hues
// spent across a scope set wide enough to tell a type from a function. These pin the
// asset map's own contract; how a palette reaches it is the resolver's, below.
describe("authored caret shiki themes", () => {
  const records = [
    ["caret-dark", CARET_DARK],
    ["caret-light", CARET_LIGHT],
  ] as const;

  test("registers one theme per caret palette, named by its key", () => {
    // Same pin the upstream registry carries: a mis-wired entry (`caret-light`
    // holding the dark theme) would otherwise resolve by the wrong handle.
    expect(Object.keys(AUTHORED_SHIKI_THEMES)).toEqual(["caret-dark", "caret-light"]);
    for (const [id, theme] of Object.entries(AUTHORED_SHIKI_THEMES)) {
      expect(theme.name, id).toBe(id);
    }
  });

  for (const [id, record] of records) {
    describe(id, () => {
      const theme = AUTHORED_SHIKI_THEMES[id];

      test("paints the editor on the record's sunk surface, in its ink", () => {
        // The same two values --paper-sunk / --ink carry, read from the record
        // rather than through the tokens: the record is the source both halves share.
        expect(theme.colors?.["editor.background"]).toBe(record.sunk);
        expect(theme.colors?.["editor.foreground"]).toBe(record.ink);
      });

      test("carries the palette's scheme as the theme type", () => {
        expect(theme.type).toBe(THEMES[id].scheme);
      });

      test("emits no color the named set does not name", () => {
        // Closure over the record: a hex typed into the theme by hand, or a hue
        // that drifted from the set, fails here rather than shipping.
        const named = new Set<string>(Object.values(record));
        for (const color of themeColors(theme)) expect(named, color).toContain(color);
      });

      test("spends every shiki-only hue", () => {
        // The reverse direction, and the point of EXC-902's set: a hue classified
        // shiki-only that no rule actually names is a color nothing paints.
        const emitted = themeColors(theme);
        for (const color of SHIKI_ONLY) {
          expect(emitted, `${id}.${color} (${record[color]})`).toContain(record[color]);
        }
      });

      test("leaves the structural markers to the resolver", () => {
        // The resolver appends structuralMarkerRules to every theme, and
        // appended-last is what makes them win. A copy carried here would sit
        // among the rules it is supposed to beat.
        const scopes = (theme.settings ?? []).flatMap((rule) => rule.scope ?? []);
        for (const scope of STRUCTURAL_SCOPES) expect(scopes).not.toContain(scope);
      });
    });
  }
});

describe("caret-theme ↔ THEMES palette sync", () => {
  // Every palette gets a highlighter theme, not just caret's own pair (EXC-752):
  // a reviewer who picks Dracula reads Dracula-colored code, not amber code.
  test("resolves one shiki theme per registered palette, named by its id", () => {
    expect(CARET_SHIKI_THEMES.map((theme) => theme.name)).toEqual(THEME_IDS);
  });

  test("highlights a vendor palette in its own colors, not caret's", () => {
    expect(shikiThemeFor("dracula").colors?.["editor.background"]).not.toBe(
      shikiThemeFor("caret-dark").colors?.["editor.background"],
    );
  });

  // Both resolution paths preserve the scheme, so a light theme can never be
  // rendered on a dark palette (or the reverse) without failing here.
  for (const id of THEME_IDS) {
    test(`${id} carries its palette's scheme as the shiki theme type`, () => {
      expect(shikiThemeFor(id).type).toBe(THEMES[id].scheme);
    });
  }

  // The derivation's contract, and caret's own pair is all of it: every color the
  // theme emits is one of the seven mapped tokens, and every mapped token is used.
  for (const id of DERIVED_IDS) {
    describe(id, () => {
      const theme: ThemeLike = shikiThemeFor(id);

      test("editor background/foreground match the THEMES tokens", () => {
        const expected = expectedPalette(id);
        expect(theme.colors?.["editor.background"]).toBe(expected.bg);
        expect(theme.colors?.["editor.foreground"]).toBe(expected.fg);
      });

      test("every emitted foreground is a mapped THEMES value", () => {
        const expected = expectedPalette(id);
        const allowed = new Set(Object.values(expected));
        for (const color of themeColors(theme)) {
          // A color the theme emits that is not one of the seven mapped tokens
          // signals the palette drifted from theme.ts (or a new color leaked in).
          expect(allowed).toContain(color);
        }
      });

      test("each mapped token appears in the emitted theme", () => {
        const expected = expectedPalette(id);
        const emitted = themeColors(theme);
        for (const [field, color] of Object.entries(expected)) {
          // Guards the reverse direction: a token the palette claims to mirror
          // must actually be used, so renaming/dropping a token is caught too.
          expect(emitted, `${id}.${field} (${color}) is used by the theme`).toContain(color);
        }
      });
    });
  }

  for (const { id, shikiTheme } of VENDOR_PALETTES) {
    describe(id, () => {
      // Resolved fresh rather than read off shikiThemeFor's cached object: shiki's
      // normalizeTheme unshifts a default fg/bg rule into the `settings` array it
      // is handed, in place, so the cached theme's rule count grows by one the
      // first time any highlighter registers it. The resolver's output is the
      // contract; the extra rule is shiki's bookkeeping, and harmless — it carries
      // no scope, which textmate reads as the theme's default fg/bg rather than as
      // a rule competing with the others.
      const theme = shikiThemeForPalette(THEMES[id]);

      test("carries the whole upstream rule set, plus caret's structural markers", () => {
        const upstream = UPSTREAM_SHIKI_THEMES[shikiTheme];
        // Same precedence withStructuralOverrides applies, so the expected length is
        // computed the way production computes it rather than paraphrasing it.
        const upstreamRules = upstream.settings ?? upstream.tokenColors ?? [];
        expect(theme.settings).toHaveLength(upstreamRules.length + STRUCTURAL_RULES);
      });

      test("emits syntax colors the seven-token derivation cannot produce", () => {
        const mapped = new Set(Object.values(expectedPalette(id)));
        const unmapped = (theme.settings ?? []).filter((rule) => {
          const fg = rule.settings?.foreground?.toLowerCase();
          return fg !== undefined && !mapped.has(fg);
        });
        // The point of the swap: Dracula's pink keyword is a color the seven
        // mapped tokens have no way to name.
        expect(unmapped.length).toBeGreaterThan(0);
      });

      // shiki is last-match-wins, so appending caret's markers is what makes them
      // win over whatever the upstream theme says about those scopes.
      test("appends caret's structural marker rules last, in order", () => {
        const tokens = THEMES[id].tokens;
        const [markers, language, raw] = (theme.settings ?? []).slice(-STRUCTURAL_RULES);
        expect(markers?.scope).toEqual([
          "markup.fenced_code.block.markdown punctuation.definition.markdown",
        ]);
        expect(markers?.settings.foreground).toBe(tokens["--ink-faint"]);
        expect(language?.scope).toEqual(["fenced_code.block.language"]);
        expect(language?.settings.foreground).toBe(tokens["--accent"]);
        expect(language?.settings.fontStyle).toBe("bold");
        expect(raw?.scope).toEqual(["punctuation.definition.raw.markdown"]);
        expect(raw?.settings.foreground).toBe(tokens["--ink-soft"]);
      });
    });
  }

  test("the two caret themes use distinct palettes (light vs dark do not collapse)", () => {
    expect(shikiThemeFor("caret-light").colors?.["editor.background"]).not.toBe(
      shikiThemeFor("caret-dark").colors?.["editor.background"],
    );
  });

  // The fallback is what caret's own pair rides, but it is a property of the
  // resolver rather than of those two ids — so drive it with a palette that would
  // otherwise resolve upstream.
  test("a palette naming no upstream theme falls back to the derivation", () => {
    const synthetic: Theme = { ...THEMES.dracula, shikiTheme: undefined };
    const fallback = shikiThemeForPalette(synthetic);
    expect(fallback.settings?.length).toBe(
      shikiThemeForPalette(THEMES["caret-dark"]).settings?.length,
    );
    const allowed = new Set(Object.values(expectedPalette("dracula")));
    for (const color of themeColors(fallback)) expect(allowed).toContain(color);
  });
});

// EXC-692: the plan view renders the plan as a markdown document, so a fenced
// code block's opening line (```lang) is markdown-tokenized — the ``` / ~~~ fence
// markers carry punctuation.definition.markdown and the language info-string
// carries fenced_code.block.language. The theme subdues the markers to --ink-faint
// and makes the language prominent (--accent, bold) while leaving the code body's
// color untouched. Tokenizing a real fence with caret-light pins those outcomes;
// the markers and language only render as separate spans once their colors differ.
describe("caret-theme fenced-code fence line", () => {
  // The THEMES palette values are lowercase hex; shiki emits some token colors
  // uppercased, so normalize the received color (only) before comparing.
  async function tokenizeFence() {
    const hl = await createHighlighterCore({
      themes: [shikiThemeFor("caret-light")],
      langs: [import("shiki/langs/markdown.mjs")],
      engine: createJavaScriptRegexEngine(),
    });
    const md = ["```ts", "code", "```"].join("\n");
    return hl.codeToTokensBase(md, { lang: "markdown", theme: "caret-light" });
  }

  test("subdues the fence backticks to --ink-faint", async () => {
    const expected = expectedPalette("caret-light");
    const [line1] = await tokenizeFence();
    const backticks = line1?.find((t) => t.content === "```");
    expect(backticks?.color?.toLowerCase()).toBe(expected.comment);
  });

  test("renders the language tag in bold --accent", async () => {
    const expected = expectedPalette("caret-light");
    const [line1] = await tokenizeFence();
    const lang = line1?.find((t) => t.content === "ts");
    expect(lang?.color?.toLowerCase()).toBe(expected.keyword);
    // shiki FontStyle bitmask: bit value 2 is bold.
    expect((lang?.fontStyle ?? 0) & 2).toBe(2);
  });

  test("leaves the code body color unchanged (--accent-bright)", async () => {
    const expected = expectedPalette("caret-light");
    const code = (await tokenizeFence())[1]?.find((t) => t.content === "code");
    expect(code?.color?.toLowerCase()).toBe(expected.entity);
  });
});

// fileRefTag.ts tags the token that BEGINS at a file reference's start column — the
// column past the opening backtick — so the backtick has to be a token of its own.
// Whether it is depends on the THEME, not the grammar: shiki merges adjacent tokens
// that style identically, and every upstream theme colors
// `punctuation.definition.raw.markdown` the same as `markup.inline.raw`. Without
// caret's override the whole `` `path` `` collapses into one token starting at the
// backtick, no token begins at the path, and the file icon, pointer cursor, and hover
// chip all silently vanish while the click target survives (EXC-687, EXC-840). No
// color assertion can see that, so pin the boundary itself.
describe("inline-code file references stay tokenized for fileRefTag", () => {
  const LINE = "See `ui/src/lib/theme.ts` for details.";
  const PATH_COL = LINE.indexOf("`") + 1;

  let shared: Awaited<ReturnType<typeof createHighlighterCore>> | undefined;
  async function tokenize(id: ThemeId) {
    shared ??= await createHighlighterCore({
      themes: THEME_IDS.map(shikiThemeFor),
      langs: [import("shiki/langs/markdown.mjs")],
      engine: createJavaScriptRegexEngine(),
    });
    return shared.codeToTokensBase(LINE, { lang: "markdown", theme: id })[0] ?? [];
  }

  for (const id of THEME_IDS) {
    test(`${id} emits a token beginning at the path`, async () => {
      // The same running-length walk tagTokenAt performs over the rendered spans.
      const starts = new Set<number>();
      let col = 0;
      for (const token of await tokenize(id)) {
        starts.add(col);
        col += token.content.length;
      }
      expect(starts).toContain(PATH_COL);
    });
  }
});

// The vendor half of the same fence line. caret's two appended rules still win on
// the fence itself, while the block's body is tokenized by the embedded TypeScript
// grammar and colored by real Dracula — `const` renders Dracula's pink, which the
// seven-token derivation maps nowhere.
describe("dracula fenced-code block", () => {
  async function tokenizeFence() {
    const hl = await createHighlighterCore({
      themes: [shikiThemeFor("dracula")],
      langs: [import("shiki/langs/markdown.mjs"), import("shiki/langs/typescript.mjs")],
      engine: createJavaScriptRegexEngine(),
    });
    const md = ["```ts", "const x = 1", "```"].join("\n");
    return hl.codeToTokensBase(md, { lang: "markdown", theme: "dracula" });
  }

  test("keeps caret's fence treatment over the upstream theme", async () => {
    const expected = expectedPalette("dracula");
    const [line1] = await tokenizeFence();
    expect(line1?.find((t) => t.content === "```")?.color?.toLowerCase()).toBe(expected.comment);
    const lang = line1?.find((t) => t.content === "ts");
    expect(lang?.color?.toLowerCase()).toBe(expected.keyword);
    expect((lang?.fontStyle ?? 0) & 2).toBe(2);
  });

  test("colors the code body in real Dracula", async () => {
    const body = (await tokenizeFence())[1]?.find((t) => t.content === "const");
    expect(body?.color?.toLowerCase()).toBe("#ff79c6");
  });
});
