// A theme file's markdown styles, as the plan view and the feedback editor paint them:
// each element in its own color and font style, and an element a file leaves unstyled in
// caret's own ink. This needs a real browser: the plan's colors resolve through shiki's
// token variables and the override sheet inside the diff view's shadow DOM, the bullet is
// a pseudo-element, and both surfaces' font styles ride declarations whose cascade only a
// real engine settles. The pure halves are unit-tested — the schema in
// test/core/theme/schema.test.ts, the painted custom properties in
// ui/src/lib/theme.test.ts, the shiki rules in ui/src/lib/caret-theme.test.ts, and the
// heading rows and their levels in ui/src/lib/diffview/headings.test.ts.

import type { Page } from "@playwright/test";

import type { ThemeMarkdown } from "@core/theme/schema.ts";
import { goToTop } from "@test/e2e/support/cursor.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { openPlan, openPlanForKeys, probeColor } from "@test/e2e/support/source-view.ts";
import { caretThemeVariant, selectThemeFile } from "@test/e2e/support/themes.ts";

const PLAN = `# Styled heading

Prose with \`inline code\` and [a link](https://docs.example.test) beside it.

Some **bold words** and *italic words* here.

- bullet item

1. ordered item

> quoted line of text
`;

// Every element carries a font style, so each surface shows it honours them all.
const STYLES = {
  heading: { color: "#9580ff", fontStyle: ["bold"] },
  code: { color: "#8aff80", fontStyle: ["italic"] },
  link: { color: "#ff80bf", fontStyle: ["bold"] },
  bold: { color: "#ffca80", fontStyle: ["italic"] },
  italic: { color: "#ffff80", fontStyle: ["bold"] },
  listMarker: { color: "#80ffea", fontStyle: ["bold"] },
  quote: { color: "#ffff80", fontStyle: ["italic", "bold"] },
} satisfies ThemeMarkdown;

// No built-in theme uses it, so a spec can tell when its own theme has painted.
const ACCENT = "#00c2a8";

const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

/** The computed paint of each element in PLAN, read off its content token. */
function paint(page: Page) {
  return page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement).shadowRoot as ShadowRoot;
    const token = (text: string) => {
      const leaf = [...sh.querySelectorAll("[data-content] [data-line] span")].find(
        (el) => el.children.length === 0 && el.textContent?.includes(text),
      );
      if (leaf === undefined) throw new Error(`no token holds ${JSON.stringify(text)}`);
      return getComputedStyle(leaf);
    };
    const font = (style: CSSStyleDeclaration) => ({
      color: style.color,
      weight: style.fontWeight,
      slant: style.fontStyle,
    });
    const link = token("a link");
    const bullet = sh.querySelector('[data-md-list="bullet"]') as Element;
    return {
      heading: font(token("Styled heading")),
      code: font(token("inline code")),
      link: {
        ...font(link),
        underline: `${link.textDecorationLine} ${link.textDecorationStyle}`,
      },
      bold: font(token("bold words")),
      italic: font(token("italic words")),
      bullet: getComputedStyle(bullet, "::before").color,
      ordered: font(getComputedStyle(sh.querySelector('[data-md-list="ordered"]') as Element)),
      quote: { ...font(token("quoted line")), opacity: token("quoted line").opacity },
    };
  });
}

/** PLAN's paint under STYLES. */
const STYLED_PAINT = {
  heading: { color: rgb(STYLES.heading.color), weight: "700", slant: "normal" },
  code: { color: rgb(STYLES.code.color), weight: "400", slant: "italic" },
  link: {
    color: rgb(STYLES.link.color),
    weight: "700",
    slant: "normal",
    underline: "underline dotted",
  },
  bold: { color: rgb(STYLES.bold.color), weight: "700", slant: "italic" },
  italic: { color: rgb(STYLES.italic.color), weight: "700", slant: "italic" },
  bullet: rgb(STYLES.listMarker.color),
  ordered: { color: rgb(STYLES.listMarker.color), weight: "700", slant: "normal" },
  // At full strength: the quote's own color is what sets it apart from body text.
  quote: { color: rgb(STYLES.quote.color), weight: "700", slant: "italic", opacity: "1" },
};

test("a theme's markdown styles paint each element in its own color and font style", async ({
  daemon,
  page,
}) => {
  await selectThemeFile(
    page,
    daemon,
    caretThemeVariant("styled", "dark", { accent: ACCENT, markdown: STYLES }),
  );
  await openPlan(page, daemon, PLAN);

  await expect.poll(() => paint(page)).toEqual(STYLED_PAINT);
});

test("a reload paints a theme's markdown styles while its palette is cached", async ({
  daemon,
  page,
}) => {
  await selectThemeFile(
    page,
    daemon,
    caretThemeVariant("styled", "dark", { accent: ACCENT, markdown: STYLES }),
  );
  await openPlan(page, daemon, PLAN);
  await expect.poll(() => paint(page)).toEqual(STYLED_PAINT);

  await page.reload();
  await expect.poll(() => paint(page)).toEqual(STYLED_PAINT);
});

test("a theme that styles no markdown element paints each in caret's own ink", async ({
  daemon,
  page,
}) => {
  await selectThemeFile(page, daemon, caretThemeVariant("unstyled", "dark", { accent: ACCENT }));
  await openPlan(page, daemon, PLAN);
  await expect.poll(() => probeColor(page, "--accent")).toBe(rgb(ACCENT));

  const [ink, inkSoft, inkFaint, accentBright, linkInk] = await Promise.all(
    [
      "--ink",
      "--ink-soft",
      "--ink-faint",
      "--accent-bright",
      "color-mix(in lab, var(--ink), var(--accent) 45%)",
    ].map((value) => probeColor(page, value)),
  );
  await expect
    .poll(() => paint(page))
    .toEqual({
      heading: { color: rgb(ACCENT), weight: "400", slant: "normal" },
      code: { color: accentBright, weight: "400", slant: "normal" },
      link: { color: linkInk, weight: "400", slant: "normal", underline: "underline dotted" },
      bold: { color: ink, weight: "700", slant: "normal" },
      italic: { color: ink, weight: "400", slant: "italic" },
      bullet: inkSoft,
      ordered: { color: inkFaint, weight: "400", slant: "normal" },
      quote: { color: ink, weight: "400", slant: "normal", opacity: "0.88" },
    });
});

/** Open the composer from the keyboard, type a comment exercising every element, and read
 * their paint. The keyboard rather than the gutter: the plan
 * repaints as the runtime theme registers, and a gutter hover landing inside that repaint
 * is dropped. */
async function editorPaint(page: Page) {
  await goToTop(page);
  await page.keyboard.press("c");
  const input = page
    .getByRole("dialog", { name: "Add a comment" })
    .getByRole("textbox", { name: "Comment" });
  await expect(input).toBeFocused();
  // The quote comes last: Enter continues a quote, so a list typed after one lands in it.
  await page.keyboard.type(
    "# Heading words\n[a link](https://docs.example.test) **bold words** *italic words* " +
      "`inline code` ***both words***\n- listed words\n> quoted words",
  );
  await expect(input).toContainText("quoted words");
  return input.evaluate((content) => {
    // The element holding the text itself: an element the editor styles nothing in, such as
    // inline code under caret's own look, keeps its text bare inside a wider mark.
    const leaf = (text: string) => {
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node.textContent?.trim() === text)
          return getComputedStyle(node.parentElement as Element);
      }
      throw new Error(`no text node reads ${JSON.stringify(text)}`);
    };
    const font = (style: CSSStyleDeclaration) => ({
      color: style.color,
      weight: style.fontWeight,
      slant: style.fontStyle,
    });
    const link = leaf("a link");
    return {
      heading: font(leaf("Heading words")),
      code: font(leaf("inline code")),
      link: { ...font(link), underline: link.textDecorationLine },
      bold: font(leaf("bold words")),
      italic: font(leaf("italic words")),
      // Nested, so both highlight styles declare its weight: caret's own must win.
      both: font(leaf("both words")),
      quote: font(leaf("quoted words")),
      listMarker: font(leaf("-")),
    };
  });
}

test("the feedback editor paints a theme's markdown styles", async ({ daemon, page }) => {
  await selectThemeFile(
    page,
    daemon,
    caretThemeVariant("styled", "dark", { accent: ACCENT, markdown: STYLES }),
  );
  await openPlanForKeys(page, daemon, PLAN);
  await expect
    .poll(() => probeColor(page, "--markdown-heading1-color"))
    .toBe(rgb(STYLES.heading.color));

  expect(await editorPaint(page)).toEqual({
    heading: { color: rgb(STYLES.heading.color), weight: "700", slant: "normal" },
    code: { color: rgb(STYLES.code.color), weight: "400", slant: "italic" },
    link: { color: rgb(STYLES.link.color), weight: "700", slant: "normal", underline: "underline" },
    bold: { color: rgb(STYLES.bold.color), weight: "700", slant: "italic" },
    italic: { color: rgb(STYLES.italic.color), weight: "700", slant: "italic" },
    both: { color: rgb(STYLES.italic.color), weight: "700", slant: "italic" },
    quote: { color: rgb(STYLES.quote.color), weight: "700", slant: "italic" },
    listMarker: { color: rgb(STYLES.listMarker.color), weight: "700", slant: "normal" },
  });
});

test("the feedback editor keeps its own look under a theme that styles no markdown element", async ({
  daemon,
  page,
}) => {
  await selectThemeFile(page, daemon, caretThemeVariant("unstyled", "dark", { accent: ACCENT }));
  await openPlanForKeys(page, daemon, PLAN);
  await expect.poll(() => probeColor(page, "--accent")).toBe(rgb(ACCENT));

  const [ink, inkSoft, inkFaint] = await Promise.all(
    ["--ink", "--ink-soft", "--ink-faint"].map((value) => probeColor(page, value)),
  );
  expect(await editorPaint(page)).toEqual({
    heading: { color: ink, weight: "700", slant: "normal" },
    code: { color: ink, weight: "400", slant: "normal" },
    link: { color: rgb(ACCENT), weight: "400", slant: "normal", underline: "underline" },
    bold: { color: ink, weight: "700", slant: "normal" },
    italic: { color: ink, weight: "400", slant: "italic" },
    both: { color: ink, weight: "700", slant: "italic" },
    quote: { color: inkSoft, weight: "400", slant: "normal" },
    listMarker: { color: inkFaint, weight: "400", slant: "normal" },
  });
});

// Each heading level, from its own style or, without one, from `heading`. Every level's
// style differs from its neighbours' in color and font, so a level painted from another's
// reds here. The daemon's reflow rewrites a setext heading as ATX in a plan that also uses
// ATX past level 2, so the setext pair gets a plan of its own.
const LEVELS_PLAN = `# Level one

## Level two

### Level three

#### Level four

##### Level five

###### Level six
`;

const SETEXT_PLAN = `Setext one
==========

Prose between the two.

Setext two
----------

Prose after them.
`;

const LEVELS = {
  heading: { color: "#9580ff", fontStyle: ["bold"] },
  heading1: { color: "#ff80bf", fontStyle: ["bold", "italic"] },
  heading2: { color: "#8aff80", fontStyle: ["bold"] },
  heading3: { color: "#ffca80", fontStyle: ["italic"] },
  heading4: { color: "#80ffea" },
  heading5: { color: "#ffff80", fontStyle: ["bold"] },
  heading6: { color: "#c0c0ff", fontStyle: ["italic"] },
} satisfies ThemeMarkdown;

const LEVEL_TEXTS = ["one", "two", "three", "four", "five", "six"].map((n) => `Level ${n}`);

/** The paint a heading style gives its text. */
const levelPaint = ({ color, fontStyle = [] }: { color: string; fontStyle?: string[] }) => ({
  color: rgb(color),
  weight: fontStyle.includes("bold") ? "700" : "400",
  slant: fontStyle.includes("italic") ? "italic" : "normal",
});

/** The computed paint of the plan token holding each of `texts`. */
function planPaint(page: Page, texts: string[]) {
  return page.evaluate((wanted) => {
    const sh = (document.querySelector(".diffview") as HTMLElement).shadowRoot as ShadowRoot;
    return wanted.map((text) => {
      const leaf = [...sh.querySelectorAll("[data-content] [data-line] span")].find(
        (el) => el.children.length === 0 && el.textContent?.includes(text),
      );
      if (leaf === undefined) throw new Error(`no token holds ${JSON.stringify(text)}`);
      const style = getComputedStyle(leaf);
      return { color: style.color, weight: style.fontWeight, slant: style.fontStyle };
    });
  }, texts);
}

test("a theme's heading levels paint each level in its own style", async ({ daemon, page }) => {
  await selectThemeFile(
    page,
    daemon,
    caretThemeVariant("levels", "dark", { accent: ACCENT, markdown: LEVELS }),
  );
  await openPlan(page, daemon, LEVELS_PLAN);

  await expect
    .poll(() => planPaint(page, LEVEL_TEXTS))
    .toEqual(
      [
        LEVELS.heading1,
        LEVELS.heading2,
        LEVELS.heading3,
        LEVELS.heading4,
        LEVELS.heading5,
        LEVELS.heading6,
      ].map(levelPaint),
    );
});

// shiki scopes a setext heading's underline, not its text, so the text keeps its ink and
// takes only the level's font, as it takes the heading font on a theme with no levels.
test("a setext heading takes level 1 for === and level 2 for ---", async ({ daemon, page }) => {
  await selectThemeFile(
    page,
    daemon,
    caretThemeVariant("levels", "dark", { accent: ACCENT, markdown: LEVELS }),
  );
  await openPlan(page, daemon, SETEXT_PLAN);

  const [one, two] = [levelPaint(LEVELS.heading1), levelPaint(LEVELS.heading2)];
  await expect
    .poll(async () => {
      const [text1, rule1, text2, rule2] = await planPaint(page, [
        "Setext one",
        "==========",
        "Setext two",
        "----------",
      ]);
      return { text1: { ...text1, color: "" }, rule1, text2: { ...text2, color: "" }, rule2 };
    })
    .toEqual({
      text1: { ...one, color: "" },
      rule1: one,
      text2: { ...two, color: "" },
      rule2: two,
    });
});

test("a heading level without its own style takes the heading style", async ({ daemon, page }) => {
  const markdown = { heading: LEVELS.heading, heading2: LEVELS.heading4 } satisfies ThemeMarkdown;
  await selectThemeFile(
    page,
    daemon,
    caretThemeVariant("fallback", "dark", { accent: ACCENT, markdown }),
  );
  await openPlan(page, daemon, LEVELS_PLAN);

  const heading = levelPaint(LEVELS.heading);
  // Level 2's style names no bold, so its own replaces the heading's weight too.
  await expect
    .poll(() => planPaint(page, LEVEL_TEXTS))
    .toEqual([heading, levelPaint(LEVELS.heading4), heading, heading, heading, heading]);
});

// A fenced language's heading carries the parser's bare heading tag, which no level's rule
// matches, so it keeps the heading style under a theme that styles every level.
test("the feedback editor paints a fenced language's heading in the heading style", async ({
  daemon,
  page,
}) => {
  await selectThemeFile(
    page,
    daemon,
    caretThemeVariant("levels", "dark", { accent: ACCENT, markdown: LEVELS }),
  );
  await openPlanForKeys(page, daemon, PLAN);
  await expect
    .poll(() => probeColor(page, "--markdown-heading-color"))
    .toBe(rgb(LEVELS.heading.color));

  await goToTop(page);
  await page.keyboard.press("c");
  const input = page
    .getByRole("dialog", { name: "Add a comment" })
    .getByRole("textbox", { name: "Comment" });
  await expect(input).toBeFocused();
  await page.keyboard.type("```textile\nh1. Fenced title\n```");
  // The fence's language loads on demand, so its heading paints once it arrives.
  await expect
    .poll(() =>
      input.evaluate((content) => {
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          if (node.textContent?.includes("Fenced title")) {
            const style = getComputedStyle(node.parentElement as Element);
            return { color: style.color, weight: style.fontWeight, slant: style.fontStyle };
          }
        }
        throw new Error("no text node holds the fenced heading");
      }),
    )
    .toEqual(levelPaint(LEVELS.heading));
});

test("the feedback editor paints each heading level in its own style", async ({ daemon, page }) => {
  await selectThemeFile(
    page,
    daemon,
    caretThemeVariant("levels", "dark", { accent: ACCENT, markdown: LEVELS }),
  );
  await openPlanForKeys(page, daemon, PLAN);
  await expect
    .poll(() => probeColor(page, "--markdown-heading1-color"))
    .toBe(rgb(LEVELS.heading1.color));

  await goToTop(page);
  await page.keyboard.press("c");
  const input = page
    .getByRole("dialog", { name: "Add a comment" })
    .getByRole("textbox", { name: "Comment" });
  await expect(input).toBeFocused();
  await page.keyboard.type(
    `${LEVEL_TEXTS.map((text, i) => `${"#".repeat(i + 1)} ${text}`).join("\n")}\n` +
      "Setext one\n===\nSetext two\n---",
  );
  await expect(input).toContainText("Setext two");
  const paint = await input.evaluate(
    (content, texts) => {
      const leaf = (text: string) => {
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          if (node.textContent?.trim() === text) {
            const style = getComputedStyle(node.parentElement as Element);
            return { color: style.color, weight: style.fontWeight, slant: style.fontStyle };
          }
        }
        throw new Error(`no text node reads ${JSON.stringify(text)}`);
      };
      return texts.map(leaf);
    },
    [...LEVEL_TEXTS, "Setext one", "Setext two"],
  );

  expect(paint).toEqual(
    [
      LEVELS.heading1,
      LEVELS.heading2,
      LEVELS.heading3,
      LEVELS.heading4,
      LEVELS.heading5,
      LEVELS.heading6,
      LEVELS.heading1,
      LEVELS.heading2,
    ].map(levelPaint),
  );
});
