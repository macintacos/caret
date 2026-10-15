// The plan preview read like a GitHub README (EXC-2014): sans-serif prose, monospace inline
// code, a heading scale, styled lists, tables, quotes, rules and images, every element
// painted from the active theme's markdown styles or caret's own ink. This needs a real
// browser: the paint is a computed cascade of light-DOM custom properties a theme writes
// onto :root, a list bullet is a ::marker, and the table's sideways scroll and the image's
// size cap are layout. The pure halves are units — the mount in
// ui/src/components/PlanPreview.test.ts, the painted custom properties in
// ui/src/lib/theme.test.ts, and the rendered HTML in ui/src/lib/planMarkdown.test.ts.

import type { Page } from "@playwright/test";

import type { ThemeMarkdown } from "@core/theme/schema.ts";
import { previewToggle } from "@test/e2e/support/chrome.ts";
import { type Daemon, expect, test } from "@test/e2e/support/fixtures.ts";
import { GONE, GOOD, routeAssets } from "@test/e2e/support/images.ts";
import { openPlan, PLAN_PREVIEW } from "@test/e2e/support/source-view.ts";
import { caretThemeVariant, selectThemeFile } from "@test/e2e/support/themes.ts";

const PLAN = `# Styled heading

Prose with \`inline code\` and [a link](https://docs.example.test) beside it.

Some **bold words** and *italic words* here.

- bullet item

1. ordered item

> quoted line of text
`;

const LEVELS_PLAN = `# Level one

## Level two

### Level three

#### Level four

##### Level five

###### Level six
`;

const LEVEL_TEXTS = ["one", "two", "three", "four", "five", "six"].map((n) => `Level ${n}`);

const STYLES = {
  heading: { color: "#9580ff", fontStyle: ["bold"] },
  code: { color: "#8aff80", fontStyle: ["italic"] },
  link: { color: "#ff80bf", fontStyle: ["bold"] },
  bold: { color: "#ffca80", fontStyle: ["italic"] },
  italic: { color: "#ffff80", fontStyle: ["bold"] },
  listMarker: { color: "#80ffea", fontStyle: ["bold"] },
  quote: { color: "#c0c0ff", fontStyle: ["italic", "bold"] },
} satisfies ThemeMarkdown;

// No built-in theme uses it, so a spec can tell when its own theme has painted.
const ACCENT = "#00c2a8";

const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

async function openPreview(page: Page, daemon: Daemon, plan: string): Promise<void> {
  await openPlan(page, daemon, plan);
  await previewToggle(page).click();
  await expect(page.locator(PLAN_PREVIEW)).toBeVisible();
}

/** `value` — a custom property (leading `--`) or any CSS color — resolved on a light-DOM
 * probe, where the preview's own declarations resolve. */
function paletteColor(page: Page, value: string): Promise<string> {
  return page.evaluate((v) => {
    const el = document.createElement("span");
    el.style.color = v.startsWith("--") ? `var(${v})` : v;
    document.body.append(el);
    const resolved = getComputedStyle(el).color;
    el.remove();
    return resolved;
  }, value);
}

/** The computed paint of each element in PLAN, located by its text. */
function paint(page: Page) {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector) as HTMLElement;
    const holding = (tag: string, text: string) => {
      const el = [...root.querySelectorAll(tag)].find((e) => e.textContent?.includes(text));
      if (el === undefined) throw new Error(`no ${tag} holds ${JSON.stringify(text)}`);
      return el;
    };
    const font = (style: CSSStyleDeclaration) => ({
      color: style.color,
      weight: style.fontWeight,
      slant: style.fontStyle,
    });
    const link = getComputedStyle(holding("a", "a link"));
    const quote = getComputedStyle(holding("blockquote p", "quoted line"));
    return {
      heading: font(getComputedStyle(holding("h1", "Styled heading"))),
      code: font(getComputedStyle(holding("code", "inline code"))),
      link: { ...font(link), underline: `${link.textDecorationLine} ${link.textDecorationStyle}` },
      bold: font(getComputedStyle(holding("strong", "bold words"))),
      italic: font(getComputedStyle(holding("em", "italic words"))),
      bullet: font(getComputedStyle(holding("ul > li", "bullet item"), "::marker")),
      ordered: font(getComputedStyle(holding("ol > li", "ordered item"), "::marker")),
      quote: { ...font(quote), opacity: quote.opacity },
    };
  }, PLAN_PREVIEW);
}

/** A computed style property of the first `selector` match inside the preview whose text
 * holds `text`. */
function styleOf(page: Page, selector: string, text: string, property: string) {
  return page.evaluate(
    ([root, sel, txt, prop]) => {
      const el = [...document.querySelectorAll(`${root} ${sel}`)].find((e) =>
        e.textContent?.includes(txt),
      );
      if (el === undefined) throw new Error(`no ${sel} holds ${JSON.stringify(txt)}`);
      return getComputedStyle(el).getPropertyValue(prop);
    },
    [PLAN_PREVIEW, selector, text, property] as const,
  );
}

test("prose is sans-serif, inline code monospace on a chip, and headings scale down", async ({
  daemon,
  page,
}) => {
  // One h1 only: the daemon's reflow demotes a plan's second h1.
  await openPreview(page, daemon, `${LEVELS_PLAN}\nProse with \`inline code\` beside it.\n`);
  const fonts = await page.evaluate(() => {
    const probe = (prop: "fontFamily" | "backgroundColor", value: string) => {
      const el = document.createElement("span");
      el.style[prop] = value;
      document.body.append(el);
      const resolved = getComputedStyle(el)[prop];
      el.remove();
      return resolved;
    };
    return {
      sans: probe("fontFamily", "var(--font-sans)"),
      mono: probe("fontFamily", "var(--font-mono)"),
      chip: probe("backgroundColor", "var(--chip-code)"),
    };
  });
  expect(await styleOf(page, "p", "Prose with", "font-family")).toBe(fonts.sans);
  expect(await styleOf(page, "code", "inline code", "font-family")).toBe(fonts.mono);
  expect(await styleOf(page, "code", "inline code", "background-color")).toBe(fonts.chip);

  const sizes = await Promise.all(
    ["h1", "h2", "h3", "h4", "h5", "h6"].map(async (tag, i) =>
      Number.parseFloat(await styleOf(page, tag, LEVEL_TEXTS[i] as string, "font-size")),
    ),
  );
  for (let i = 1; i < sizes.length; i++) {
    expect(sizes[i]).toBeLessThan(sizes[i - 1] as number);
  }
});

test("a theme's markdown styles paint each preview element", async ({ daemon, page }) => {
  await selectThemeFile(
    page,
    daemon,
    caretThemeVariant("styled", "dark", { accent: ACCENT, markdown: STYLES }),
  );
  await openPreview(page, daemon, PLAN);

  await expect
    .poll(() => paint(page))
    .toEqual({
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
      bullet: { color: rgb(STYLES.listMarker.color), weight: "700", slant: "normal" },
      ordered: { color: rgb(STYLES.listMarker.color), weight: "700", slant: "normal" },
      quote: { color: rgb(STYLES.quote.color), weight: "700", slant: "italic", opacity: "1" },
    });
});

test("a theme that styles no markdown element paints the preview in caret's own ink", async ({
  daemon,
  page,
}) => {
  await selectThemeFile(page, daemon, caretThemeVariant("unstyled", "dark", { accent: ACCENT }));
  await openPreview(page, daemon, PLAN);
  await expect.poll(() => paletteColor(page, "--accent")).toBe(rgb(ACCENT));

  const [ink, inkSoft, inkFaint, accentBright, linkInk] = await Promise.all(
    [
      "--ink",
      "--ink-soft",
      "--ink-faint",
      "--accent-bright",
      "color-mix(in lab, var(--ink), var(--accent) 45%)",
    ].map((value) => paletteColor(page, value)),
  );
  await expect
    .poll(() => paint(page))
    .toEqual({
      // Semibold like a README heading, where the source view's heading row stays at 400.
      heading: { color: rgb(ACCENT), weight: "600", slant: "normal" },
      code: { color: accentBright, weight: "400", slant: "normal" },
      link: { color: linkInk, weight: "400", slant: "normal", underline: "underline dotted" },
      bold: { color: ink, weight: "700", slant: "normal" },
      italic: { color: ink, weight: "400", slant: "italic" },
      bullet: { color: inkSoft, weight: "400", slant: "normal" },
      ordered: { color: inkFaint, weight: "400", slant: "normal" },
      // A quote is set apart by soft ink and its rule, not by the source view's subdue.
      quote: { color: inkSoft, weight: "400", slant: "normal", opacity: "1" },
    });
});

test("a heading level without its own style takes the heading style", async ({ daemon, page }) => {
  const markdown = {
    heading: { color: "#9580ff", fontStyle: ["bold"] },
    heading2: { color: "#80ffea" },
  } satisfies ThemeMarkdown;
  await selectThemeFile(
    page,
    daemon,
    caretThemeVariant("fallback", "dark", { accent: ACCENT, markdown }),
  );
  await openPreview(page, daemon, LEVELS_PLAN);

  const levels = () =>
    Promise.all(
      ["h1", "h2", "h3", "h4", "h5", "h6"].map(async (tag, i) => ({
        color: await styleOf(page, tag, LEVEL_TEXTS[i] as string, "color"),
        weight: await styleOf(page, tag, LEVEL_TEXTS[i] as string, "font-weight"),
      })),
    );
  const heading = { color: rgb(markdown.heading.color), weight: "700" };
  await expect
    .poll(levels)
    .toEqual([
      heading,
      { color: rgb(markdown.heading2.color), weight: "400" },
      heading,
      heading,
      heading,
      heading,
    ]);
});

const LISTS_PLAN = `- outer bullet
  - middle bullet
    - inner bullet

1. outer number
   1. inner number

- [ ] open task
- [x] done task
- [/] partial task
`;

test("lists mark each depth and a task item shows its checkbox state", async ({ daemon, page }) => {
  await openPreview(page, daemon, LISTS_PLAN);
  const type = (selector: string, text: string) => styleOf(page, selector, text, "list-style-type");
  // The text is the innermost item's, so `li` resolves to the outermost holding it — read
  // each depth off the list nesting instead.
  expect(await type("ul", "outer bullet")).toBe("disc");
  expect(await type("ul ul", "middle bullet")).toBe("circle");
  expect(await type("ul ul ul", "inner bullet")).toBe("square");
  expect(await type("ol", "outer number")).toBe("decimal");
  expect(await type("ol ol", "inner number")).toBe("lower-roman");
  expect(await type("li", "open task")).toBe("none");

  const boxes = await page.evaluate((root) => {
    const box = (text: string) => {
      const li = [...document.querySelectorAll(`${root} li`)].find((e) =>
        e.textContent?.includes(text),
      );
      const input = li?.querySelector("input") as HTMLInputElement;
      return { checked: input.checked, indeterminate: input.indeterminate };
    };
    return [box("open task"), box("done task"), box("partial task")];
  }, PLAN_PREVIEW);
  expect(boxes).toEqual([
    { checked: false, indeterminate: false },
    { checked: true, indeterminate: false },
    { checked: false, indeterminate: true },
  ]);
});

// Cells wrap, so only a table whose narrowest layout overflows scrolls: many columns.
const WIDE_COLUMNS = Array.from({ length: 60 }, (_, i) => `column${i}`);
const TABLE_PLAN = `| Left | Centre | Right | Plain |
| :--- | :---: | ---: | --- |
| a | b | c | d |

| ${WIDE_COLUMNS.join(" | ")} |
|${" --- |".repeat(WIDE_COLUMNS.length)}
|${" x |".repeat(WIDE_COLUMNS.length)}
`;

test("a table has headers, borders, column alignment and scrolls on its own", async ({
  daemon,
  page,
}) => {
  await openPreview(page, daemon, TABLE_PLAN);
  expect(Number(await styleOf(page, "th", "Left", "font-weight"))).toBeGreaterThanOrEqual(600);
  expect(Number.parseFloat(await styleOf(page, "td", "a", "border-top-width"))).toBeGreaterThan(0);
  expect(await styleOf(page, "th", "Left", "text-align")).toBe("left");
  expect(await styleOf(page, "th", "Centre", "text-align")).toBe("center");
  expect(await styleOf(page, "th", "Right", "text-align")).toBe("right");
  expect(await styleOf(page, "th", "Plain", "text-align")).toBe("start");

  const wide = await page.evaluate((root) => {
    const table = [...document.querySelectorAll(`${root} table`)].find((t) =>
      t.textContent?.includes("column59"),
    ) as HTMLElement;
    const plan = document.querySelector(".diff-plan") as HTMLElement;
    return {
      overflow: getComputedStyle(table).overflowX,
      scrolls: table.scrollWidth > table.clientWidth,
      planScrolls: plan.scrollWidth > plan.clientWidth,
    };
  }, PLAN_PREVIEW);
  expect(wide).toEqual({ overflow: "auto", scrolls: true, planScrolls: false });
});

test("nested quotes carry a rule, and a thematic break draws a bar", async ({ daemon, page }) => {
  await openPreview(page, daemon, `> outer quote\n>\n> > inner quote\n\n---\n\nAfter the break.\n`);
  const quotes = await page.evaluate(
    (root) =>
      [...document.querySelectorAll(`${root} blockquote`)].map((q) => {
        const s = getComputedStyle(q);
        return { style: s.borderLeftStyle, width: Number.parseFloat(s.borderLeftWidth) > 0 };
      }),
    PLAN_PREVIEW,
  );
  expect(quotes).toEqual([
    { style: "solid", width: true },
    { style: "solid", width: true },
  ]);
  const rule = await page.evaluate((root) => {
    const hr = document.querySelector(`${root} hr`) as HTMLElement;
    return {
      height: hr.getBoundingClientRect().height,
      fill: getComputedStyle(hr).backgroundColor,
    };
  }, PLAN_PREVIEW);
  expect(rule.height).toBeGreaterThan(0);
  expect(rule.fill).not.toBe("rgba(0, 0, 0, 0)");
});

test("an image fits the preview and a failed one is hidden", async ({ daemon, page }) => {
  await routeAssets(page);
  await openPreview(page, daemon, `![the diagram](${GOOD})\n\n![missing](${GONE})\n`);
  const images = () =>
    page.evaluate((root) => {
      const preview = document.querySelector(root) as HTMLElement;
      const s = getComputedStyle(preview);
      const content =
        preview.clientWidth - Number.parseFloat(s.paddingLeft) - Number.parseFloat(s.paddingRight);
      const img = (src: string) =>
        [...preview.querySelectorAll("img")].find((i) => i.getAttribute("src") === src) as
          | HTMLImageElement
          | undefined;
      const good = img("https://assets.test/diagram.png");
      return {
        decoded: (good?.naturalWidth ?? 0) > 0,
        fits: (good?.getBoundingClientRect().width ?? Infinity) <= content + 0.5,
        goneHidden: img("https://assets.test/absent.png")?.hidden ?? false,
      };
    }, PLAN_PREVIEW);
  await expect.poll(images).toEqual({ decoded: true, fits: true, goneHidden: true });
});

test("the preview follows a light/dark switch live", async ({ daemon, page }) => {
  const dark = { heading: { color: "#9580ff" } } satisfies ThemeMarkdown;
  const light = { heading: { color: "#a03070" } } satisfies ThemeMarkdown;
  await selectThemeFile(
    page,
    daemon,
    caretThemeVariant("night", "dark", { accent: ACCENT, markdown: dark }),
  );
  await selectThemeFile(
    page,
    daemon,
    caretThemeVariant("day", "light", { accent: ACCENT, markdown: light }),
  );
  await openPreview(page, daemon, PLAN);
  const h1 = () => styleOf(page, "h1", "Styled heading", "color");
  await expect.poll(h1).toBe(rgb(dark.heading.color));

  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(h1).toBe(rgb(light.heading.color));
});
