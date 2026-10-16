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
import {
  ACCENT,
  LEVEL_TEXTS,
  LEVELS_PLAN,
  PLAN,
  rgb,
  STYLES,
} from "@test/e2e/support/markdown-styles.ts";
import { openPlan, PLAN_PREVIEW, PLAN_SURFACE } from "@test/e2e/support/source-view.ts";
import { caretThemeVariant, selectThemeFile } from "@test/e2e/support/themes.ts";

async function showPreview(page: Page): Promise<void> {
  await previewToggle(page).click();
  await expect(page.locator(PLAN_PREVIEW)).toBeVisible();
}

async function openPreview(page: Page, daemon: Daemon, plan: string): Promise<void> {
  await openPlan(page, daemon, plan);
  await showPreview(page);
}

/** `value` — a custom property (leading `--`) or any CSS value — set as `property` on a
 * light-DOM probe and read back computed, where the preview's own declarations resolve. */
function resolveStyle(
  page: Page,
  property: "color" | "fontFamily" | "backgroundColor",
  value: string,
): Promise<string> {
  return page.evaluate(
    ([property, value]) => {
      const el = document.createElement("span");
      el.style[property] = value.startsWith("--") ? `var(${value})` : value;
      document.body.append(el);
      const resolved = getComputedStyle(el)[property];
      el.remove();
      return resolved;
    },
    [property, value] as const,
  );
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

/** A probe's selector inside the preview, the text its element holds, and the computed
 * property to read off it. */
type Probe = readonly [selector: string, text: string, property: string];

/** Each probe's computed value, keyed like `probes`; `null` where no element matches. */
function stylesOf<K extends string>(page: Page, probes: Record<K, Probe>) {
  return page.evaluate(
    ([root, probes]) =>
      Object.fromEntries(
        Object.entries(probes).map(([key, [selector, text, property]]) => {
          const el = [...document.querySelectorAll(`${root} ${selector}`)].find((e) =>
            e.textContent?.includes(text),
          );
          return [key, el === undefined ? null : getComputedStyle(el).getPropertyValue(property)];
        }),
      ),
    [PLAN_PREVIEW, probes as Record<string, Probe>] as const,
  ) as Promise<Record<K, string | null>>;
}

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"];

test("prose is sans-serif, inline code monospace on a chip, and headings scale down", async ({
  daemon,
  page,
}) => {
  await openPreview(page, daemon, `${LEVELS_PLAN}\nProse with \`inline code\` beside it.\n`);
  const [sans, mono, chip] = await Promise.all([
    resolveStyle(page, "fontFamily", "--font-sans"),
    resolveStyle(page, "fontFamily", "--font-mono"),
    resolveStyle(page, "backgroundColor", "--chip-code"),
  ]);
  await expect
    .poll(() =>
      stylesOf(page, {
        prose: ["p", "Prose with", "font-family"],
        code: ["code", "inline code", "font-family"],
        chip: ["code", "inline code", "background-color"],
      }),
    )
    .toEqual({ prose: sans, code: mono, chip });

  const headingSizes = async () => {
    const probes = Object.fromEntries(
      HEADING_TAGS.map((tag, i) => [tag, [tag, LEVEL_TEXTS[i] as string, "font-size"] as const]),
    );
    const read = await stylesOf(page, probes);
    return HEADING_TAGS.map((tag) => Number.parseFloat(read[tag] ?? "NaN"));
  };
  await expect
    .poll(async () => {
      const sizes = await headingSizes();
      return sizes.every((size, i) => i === 0 || size < (sizes[i - 1] as number));
    })
    .toBe(true);
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

/** The source view's computed color for the token holding "a link". */
function sourceLinkColor(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const sh = document.querySelector(".diffview")?.shadowRoot;
    const leaf = [...(sh?.querySelectorAll("[data-content] [data-line] span") ?? [])].find(
      (el) => el.children.length === 0 && el.textContent?.includes("a link"),
    );
    return leaf === undefined ? null : getComputedStyle(leaf).color;
  });
}

test("a theme that styles no markdown element paints the preview in caret's own ink", async ({
  daemon,
  page,
}) => {
  await selectThemeFile(page, daemon, caretThemeVariant("unstyled", "dark", { accent: ACCENT }));
  await openPlan(page, daemon, PLAN);
  await expect.poll(() => resolveStyle(page, "color", "--accent")).toBe(rgb(ACCENT));
  // The preview's link ink must match the source view's, whatever mix that one uses.
  await expect.poll(() => sourceLinkColor(page)).not.toBeNull();
  const linkInk = await sourceLinkColor(page);
  await showPreview(page);

  const [ink, inkSoft, inkFaint, accentBright] = await Promise.all(
    ["--ink", "--ink-soft", "--ink-faint", "--accent-bright"].map((value) =>
      resolveStyle(page, "color", value),
    ),
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

/** A chip's box: its paddings in ems of its own font-size, and its corner radius. */
type ChipBox = { top: string; left: string; right: string; radius: string };

/** The source view's chip box for `member`, assembled from the pieces the decoration pass
 * tags on the row holding `text`: the start cap carries the left padding and radius, the
 * end cap the right padding. Null until the row is tagged. */
function sourceChip(page: Page, member: string, text: string): Promise<ChipBox | null> {
  return page.evaluate(
    ([member, text]) => {
      const sh = document.querySelector(".diffview")?.shadowRoot;
      const row = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find((el) =>
        el.textContent?.includes(text),
      );
      const piece = (attr: string) => row?.querySelector(`[${attr}~="${member}"]`);
      const [any, start, end] = [piece("data-md"), piece("data-md-start"), piece("data-md-end")];
      if (!any || !start || !end) return null;
      const em = (el: Element, property: string) => {
        const cs = getComputedStyle(el);
        const px = Number.parseFloat(cs.getPropertyValue(property));
        return (px / Number.parseFloat(cs.fontSize)).toFixed(2);
      };
      return {
        top: em(any, "padding-top"),
        left: em(start, "padding-left"),
        right: em(end, "padding-right"),
        radius: getComputedStyle(start).borderTopLeftRadius,
      };
    },
    [member, text] as const,
  );
}

/** The preview's chip box for the `tag` element holding `text`, read like `sourceChip`. */
function previewChip(page: Page, tag: string, text: string): Promise<ChipBox | null> {
  return page.evaluate(
    ([root, tag, text]) => {
      const el = [...document.querySelectorAll(`${root} ${tag}`)].find((e) =>
        e.textContent?.includes(text),
      );
      if (!el) return null;
      const cs = getComputedStyle(el);
      const em = (px: string) =>
        (Number.parseFloat(px) / Number.parseFloat(cs.fontSize)).toFixed(2);
      return {
        top: em(cs.paddingTop),
        left: em(cs.paddingLeft),
        right: em(cs.paddingRight),
        radius: cs.borderTopLeftRadius,
      };
    },
    [PLAN_PREVIEW, tag, text] as const,
  );
}

test("links and inline code wear the source view's chips", async ({ daemon, page }) => {
  await openPlan(page, daemon, PLAN);
  await expect.poll(() => sourceChip(page, "link", "a link")).not.toBeNull();
  await expect.poll(() => sourceChip(page, "code", "inline code")).not.toBeNull();
  const [link, code] = await Promise.all([
    sourceChip(page, "link", "a link"),
    sourceChip(page, "code", "inline code"),
  ]);
  await showPreview(page);

  await expect.poll(() => previewChip(page, "a", "a link")).toEqual(link);
  await expect.poll(() => previewChip(page, "code", "inline code")).toEqual(code);
  const tint = await resolveStyle(page, "backgroundColor", "--chip-link");
  await expect
    .poll(async () => (await stylesOf(page, { fill: ["a", "a link", "background-color"] })).fill)
    .toBe(tint);
});

test("a link labelled with inline code wears the code's chip alone", async ({ daemon, page }) => {
  await openPreview(page, daemon, "See [`the docs`](https://docs.example.test) here.\n");
  await expect
    .poll(() =>
      stylesOf(page, {
        padding: ["a", "the docs", "padding-left"],
        fill: ["a", "the docs", "background-color"],
      }),
    )
    .toEqual({ padding: "0px", fill: "rgba(0, 0, 0, 0)" });
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

  const levels = async () => {
    const read = await stylesOf(
      page,
      Object.fromEntries(
        HEADING_TAGS.flatMap((tag, i) => [
          [`${tag}color`, [tag, LEVEL_TEXTS[i] as string, "color"] as const],
          [`${tag}weight`, [tag, LEVEL_TEXTS[i] as string, "font-weight"] as const],
        ]),
      ),
    );
    return HEADING_TAGS.map((tag) => ({
      color: read[`${tag}color`],
      weight: read[`${tag}weight`],
    }));
  };
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
  // The text is the innermost item's, so `li` resolves to the outermost holding it — read
  // each depth off the list nesting instead.
  await expect
    .poll(() =>
      stylesOf(page, {
        outer: ["ul", "outer bullet", "list-style-type"],
        middle: ["ul ul", "middle bullet", "list-style-type"],
        inner: ["ul ul ul", "inner bullet", "list-style-type"],
        number: ["ol", "outer number", "list-style-type"],
        innerNumber: ["ol ol", "inner number", "list-style-type"],
        task: ["li", "open task", "list-style-type"],
      }),
    )
    .toEqual({
      outer: "disc",
      middle: "circle",
      inner: "square",
      number: "decimal",
      innerNumber: "lower-roman",
      task: "none",
    });

  const inkSoft = await resolveStyle(page, "color", "--ink-soft");
  await expect
    .poll(() =>
      page.evaluate((root) => {
        const box = (text: string) => {
          const li = [...document.querySelectorAll(`${root} li`)].find((e) =>
            e.textContent?.includes(text),
          );
          const input = li?.querySelector("input");
          if (!input) return null;
          return {
            checked: input.checked,
            indeterminate: input.indeterminate,
            border: getComputedStyle(input).borderTopColor,
          };
        };
        return [box("open task"), box("done task"), box("partial task")];
      }, PLAN_PREVIEW),
    )
    .toEqual([
      { checked: false, indeterminate: false, border: inkSoft },
      { checked: true, indeterminate: false, border: inkSoft },
      { checked: false, indeterminate: true, border: inkSoft },
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
  await expect
    .poll(async () => {
      const styles = await stylesOf(page, {
        weight: ["th", "Left", "font-weight"],
        border: ["td", "a", "border-top-width"],
        left: ["th", "Left", "text-align"],
        centre: ["th", "Centre", "text-align"],
        right: ["th", "Right", "text-align"],
        plain: ["th", "Plain", "text-align"],
      });
      return {
        bold: Number(styles.weight) >= 600,
        bordered: Number.parseFloat(styles.border ?? "0") > 0,
        // Chromium maps a cell's align attribute to -webkit-left and the like.
        left: /left$/.test(styles.left ?? ""),
        centre: /center$/.test(styles.centre ?? ""),
        right: /right$/.test(styles.right ?? ""),
        plain: styles.plain,
      };
    })
    .toEqual({ bold: true, bordered: true, left: true, centre: true, right: true, plain: "start" });

  await expect
    .poll(() =>
      page.evaluate(
        ([root, surface]) => {
          const table = [...document.querySelectorAll(`${root} table`)].find((t) =>
            t.textContent?.includes("column59"),
          );
          const plan = document.querySelector(surface);
          if (!table || !plan) return null;
          return {
            overflow: getComputedStyle(table).overflowX,
            scrolls: table.scrollWidth > table.clientWidth,
            planScrolls: plan.scrollWidth > plan.clientWidth,
          };
        },
        [PLAN_PREVIEW, PLAN_SURFACE] as const,
      ),
    )
    .toEqual({ overflow: "auto", scrolls: true, planScrolls: false });
});

test("nested quotes carry a rule, and a thematic break draws a bar", async ({ daemon, page }) => {
  await openPreview(page, daemon, `> outer quote\n>\n> > inner quote\n\n---\n\nAfter the break.\n`);
  const inkSoft = await resolveStyle(page, "color", "--ink-soft");
  await expect
    .poll(() =>
      page.evaluate((root) => {
        const hr = document.querySelector(`${root} hr`);
        return {
          quotes: [...document.querySelectorAll(`${root} blockquote`)].map((q) => {
            const quoteStyle = getComputedStyle(q);
            return {
              style: quoteStyle.borderLeftStyle,
              width: Number.parseFloat(quoteStyle.borderLeftWidth) > 0,
              color: quoteStyle.borderLeftColor,
            };
          }),
          rule: hr && {
            drawn: hr.getBoundingClientRect().height > 0,
            fill: getComputedStyle(hr).backgroundColor,
          },
        };
      }, PLAN_PREVIEW),
    )
    .toEqual({
      quotes: [
        { style: "solid", width: true, color: inkSoft },
        { style: "solid", width: true, color: inkSoft },
      ],
      rule: { drawn: true, fill: inkSoft },
    });
});

test("an image fits the preview and a failed one is hidden", async ({ daemon, page }) => {
  // Narrower than GOOD's 900px, so the image's size cap has to bind.
  await page.setViewportSize({ width: 800, height: 900 });
  await routeAssets(page);
  await openPreview(page, daemon, `![the diagram](${GOOD})\n\n![missing](${GONE})\n`);
  const images = () =>
    page.evaluate(
      ([root, good, gone]) => {
        const preview = document.querySelector(root) as HTMLElement;
        const previewStyle = getComputedStyle(preview);
        const contentWidth =
          preview.clientWidth -
          Number.parseFloat(previewStyle.paddingLeft) -
          Number.parseFloat(previewStyle.paddingRight);
        const img = (src: string) =>
          [...preview.querySelectorAll("img")].find((i) => i.getAttribute("src") === src);
        const goodImage = img(good);
        const width = goodImage?.getBoundingClientRect().width ?? Infinity;
        return {
          decoded: (goodImage?.naturalWidth ?? 0) > 0,
          fits: width <= contentWidth + 0.5,
          capped: width < (goodImage?.naturalWidth ?? 0),
          goneHidden: img(gone)?.hidden ?? false,
        };
      },
      [PLAN_PREVIEW, GOOD, GONE] as const,
    );
  await expect.poll(images).toEqual({ decoded: true, fits: true, capped: true, goneHidden: true });
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
  const headingColor = async () =>
    (await stylesOf(page, { color: ["h1", "Styled heading", "color"] })).color;
  await expect.poll(headingColor).toBe(rgb(dark.heading.color));

  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(headingColor).toBe(rgb(light.heading.color));
});
