// A theme file's markdown styles, as the plan view and the feedback editor paint them:
// each element in its own color and font style, and an element a file leaves unstyled in
// caret's own ink. This needs a real browser: the plan's colors resolve through shiki's
// token variables and the override sheet inside the diff view's shadow DOM, the bullet is
// a pseudo-element, and both surfaces' font styles ride declarations whose cascade only a
// real engine settles. The pure halves are unit-tested — the schema in
// test/core/theme/schema.test.ts, the painted custom properties in
// ui/src/lib/theme.test.ts, the shiki rules in ui/src/lib/caret-theme.test.ts, and the
// heading rows in ui/src/lib/diffview/headings.test.ts.

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

const STYLES = {
  heading: { color: "#9580ff", fontStyle: ["bold"] },
  code: { color: "#8aff80" },
  link: { color: "#ff80bf" },
  bold: { color: "#ffca80" },
  italic: { color: "#ffff80" },
  listMarker: { color: "#80ffea" },
  quote: { color: "#ffff80", fontStyle: ["italic"] },
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
      ordered: getComputedStyle(sh.querySelector('[data-md-list="ordered"]') as Element).color,
      quote: { ...font(token("quoted line")), opacity: token("quoted line").opacity },
    };
  });
}

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

  await expect
    .poll(() => paint(page))
    .toEqual({
      heading: { color: rgb(STYLES.heading.color), weight: "700", slant: "normal" },
      code: { color: rgb(STYLES.code.color), weight: "400", slant: "normal" },
      link: {
        color: rgb(STYLES.link.color),
        weight: "400",
        slant: "normal",
        underline: "underline dotted",
      },
      bold: { color: rgb(STYLES.bold.color), weight: "700", slant: "normal" },
      italic: { color: rgb(STYLES.italic.color), weight: "400", slant: "italic" },
      bullet: rgb(STYLES.listMarker.color),
      ordered: rgb(STYLES.listMarker.color),
      // At full strength: the quote's own color is what sets it apart from body text.
      quote: { color: rgb(STYLES.quote.color), weight: "400", slant: "italic", opacity: "1" },
    });
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
      ordered: inkFaint,
      quote: { color: ink, weight: "400", slant: "normal", opacity: "0.88" },
    });
});

/** Open the composer from the keyboard, type a comment exercising the four elements the
 * editor styles, and read their paint. The keyboard rather than the gutter: the plan
 * repaints as the runtime theme registers, and a gutter hover landing inside that repaint
 * is dropped. */
async function editorPaint(page: Page) {
  await goToTop(page);
  await page.keyboard.press("c");
  const input = page
    .getByRole("dialog", { name: "Add a comment" })
    .getByRole("textbox", { name: "Comment" });
  await expect(input).toBeFocused();
  await page.keyboard.type(
    "# Heading words\n[a link](https://docs.example.test)\n> quoted words\n\n",
  );
  await page.keyboard.type("- listed words");
  await expect(input).toContainText("listed words");
  return input.evaluate((content) => {
    const leaf = (text: string) => {
      const el = [...content.querySelectorAll("span")].find(
        (span) => span.children.length === 0 && span.textContent?.trim() === text,
      );
      if (el === undefined) throw new Error(`no span reads ${JSON.stringify(text)}`);
      return getComputedStyle(el);
    };
    const heading = leaf("Heading words");
    const link = leaf("a link");
    const quote = leaf("quoted words");
    return {
      heading: { color: heading.color, weight: heading.fontWeight, slant: heading.fontStyle },
      link: { color: link.color, underline: link.textDecorationLine },
      quote: { color: quote.color, slant: quote.fontStyle },
      listMarker: leaf("-").color,
    };
  });
}

test("the feedback editor paints a theme's heading, link, quote and list-marker styles", async ({
  daemon,
  page,
}) => {
  await selectThemeFile(
    page,
    daemon,
    caretThemeVariant("styled", "dark", { accent: ACCENT, markdown: STYLES }),
  );
  await openPlanForKeys(page, daemon, PLAN);
  await expect
    .poll(() => probeColor(page, "--markdown-heading-color"))
    .toBe(rgb(STYLES.heading.color));

  expect(await editorPaint(page)).toEqual({
    heading: { color: rgb(STYLES.heading.color), weight: "700", slant: "normal" },
    link: { color: rgb(STYLES.link.color), underline: "underline" },
    quote: { color: rgb(STYLES.quote.color), slant: "italic" },
    listMarker: rgb(STYLES.listMarker.color),
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
    link: { color: rgb(ACCENT), underline: "underline" },
    quote: { color: inkSoft, slant: "normal" },
    listMarker: inkFaint,
  });
});
