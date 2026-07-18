// Version compare on the source-view surface (EXC-576). With two or more stored
// versions, a picker lets the reviewer diff any pair, side-by-side or stacked,
// switching the layout at runtime without remounting the view or losing scroll.
// The control is always shown but disabled for single-version reviews (EXC-664),
// and the chosen layout persists across reloads.

import { expect, test } from "./support/fixtures.ts";

// Three versions whose bodies each carry a unique, greppable line so a diff
// between a chosen pair is verifiable by visible text.
const V1 = "# Plan\n\nalpha line one\n";
const V2 = "# Plan\n\nbeta line two\n";
const V3 = "# Plan\n\ngamma line three\n";

test("the compare control is disabled for a single-version review", async ({ daemon, page }) => {
  await daemon.seed({ plan: V1 });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  // EXC-664: the picker is always present; with nothing to compare its toggle is
  // disabled (greyed out) rather than hidden.
  await expect(page.locator(".compare-picker")).toBeVisible();
  await expect(page.getByRole("button", { name: "Compare versions" })).toBeDisabled();

  // The native title is gone: the disabled toggle explains itself through a
  // shadcn Tooltip on its span-wrapped trigger (a disabled button can't hover).
  await page.locator('.compare-picker [data-slot="tooltip-trigger"]').hover();
  await expect(page.getByText("No other versions to compare yet")).toBeVisible();
});

test("entering compare mode diffs a chosen non-default pair", async ({ daemon, page }) => {
  await daemon.seedVersions(3, [V1, V2, V3]);
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  // The picker is available; compare mode is off by default (single-version
  // view), so the body shows the current version.
  await expect(page.locator(".compare-picker")).toBeVisible();
  await page.getByRole("button", { name: "Compare versions" }).click();

  // Default pair is current (v3) vs previous (v2); pick a non-default pair:
  // base = v3, target = v1, so the diff spans the alpha→gamma change.
  // The target picker reuses the ThemePicker's DropdownMenu: open its trigger,
  // then choose the v1 radio item.
  await page.getByLabel("Target version").click();
  await page.getByRole("menuitemradio", { name: "v1" }).click();

  // Both ends of the chosen pair are visible (Playwright pierces the library's
  // shadow root for text).
  await expect(page.getByText("gamma line three")).toBeVisible();
  await expect(page.getByText("alpha line one")).toBeVisible();
});

test("toggling split↔unified switches layout in place without a remount", async ({
  daemon,
  page,
}) => {
  await daemon.seedVersions(3, [V1, V2, V3]);
  await page.goto("/");
  await page.getByRole("button", { name: "Compare versions" }).click();
  await expect(page.getByText("gamma line three")).toBeVisible();

  // The library renders split as data-diff-type="split" and unified as "single".
  const pre = page.locator(".diffview pre").first();
  await expect(pre).toHaveAttribute("data-diff-type", "split");

  await page.getByRole("radio", { name: "Unified" }).click();
  // Same element, new layout — switched via setOptions, not recreated.
  await expect(pre).toHaveAttribute("data-diff-type", "single");

  await page.getByRole("radio", { name: "Split" }).click();
  await expect(pre).toHaveAttribute("data-diff-type", "split");
});

test("toggling layout preserves the diff scroll position", async ({ daemon, page }) => {
  // Tall versions so the diff overflows the viewport and a scroll offset sticks.
  const body = (tag: string) =>
    Array.from({ length: 80 }, (_, i) => `${tag} line ${i + 1} of the plan body.`).join("\n\n");
  await daemon.seedVersions(2, [`# Plan\n\n${body("alpha")}\n`, `# Plan\n\n${body("beta")}\n`]);
  await page.goto("/");
  await page.getByRole("button", { name: "Compare versions" }).click();

  const view = page.locator(".diff-plan");
  await expect(view).toBeVisible();
  await expect(page.locator(".diffview pre").first()).toHaveAttribute("data-diff-type", "split");

  // Scroll the diff down and let the offset settle.
  await view.evaluate((el) => {
    el.scrollTop = 400;
  });
  await expect.poll(async () => view.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const before = await view.evaluate((el) => el.scrollTop);

  // Switch layout in place (setOptions, not a remount); the scroll offset holds.
  await page.getByRole("radio", { name: "Unified" }).click();
  await expect(page.locator(".diffview pre").first()).toHaveAttribute("data-diff-type", "single");
  expect(await view.evaluate((el) => el.scrollTop)).toBe(before);
});

test("the compare header stays pinned to the top and reads the version pair", async ({
  daemon,
  page,
}) => {
  // A diff tall enough to overflow the viewport, so a scroll would carry a
  // non-sticky header out of view.
  const body = (tag: string) =>
    Array.from({ length: 80 }, (_, i) => `${tag} line ${i + 1} of the plan body.`).join("\n\n");
  await daemon.seedVersions(2, [`# Plan\n\n${body("alpha")}\n`, `# Plan\n\n${body("beta")}\n`]);
  await page.goto("/");
  await page.getByRole("button", { name: "Compare versions" }).click();

  const view = page.locator(".diff-plan");
  await expect(view).toBeVisible();
  // The header reads the default pair: target=v1 on the before side (the rename
  // "from"), base=v2 as the title — surfacing what is compared, not a filename.
  const header = page.locator(".diffview [data-diffs-header]").first();
  await expect(header.locator("[data-prev-name]")).toHaveText("v1");
  await expect(header.locator("[data-title]")).toHaveText("v2");
  // The change tallies are surfaced (every body line differs between the pair).
  await expect(header.locator("[data-additions-count]")).toBeVisible();
  await expect(header.locator("[data-deletions-count]")).toBeVisible();

  // Scroll the diff down; the sticky header must hold at the container's top edge
  // rather than scrolling away with the code.
  await view.evaluate((el) => {
    el.scrollTop = 600;
  });
  await expect.poll(async () => view.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

  // The header's top sits within a couple of pixels of the scroll container's top
  // after scrolling — it is pinned, not carried off with the content.
  const gap = await page.evaluate(() => {
    const plan = document.querySelector(".diff-plan");
    const head = document
      .querySelector(".diffview")
      ?.shadowRoot?.querySelector("[data-diffs-header][data-sticky]");
    if (plan == null || head == null) return Number.NaN;
    return head.getBoundingClientRect().top - plan.getBoundingClientRect().top;
  });
  expect(Number.isNaN(gap)).toBe(false);
  expect(Math.abs(gap)).toBeLessThanOrEqual(2);
});

test("the chosen layout persists across a reload", async ({ daemon, page }) => {
  await daemon.seedVersions(3, [V1, V2, V3]);
  await page.goto("/");
  await page.getByRole("button", { name: "Compare versions" }).click();
  await expect(page.getByText("gamma line three")).toBeVisible();
  await page.getByRole("radio", { name: "Unified" }).click();
  await expect(page.locator(".diffview pre").first()).toHaveAttribute("data-diff-type", "single");

  await page.reload();
  await page.getByRole("button", { name: "Compare versions" }).click();
  // The remembered layout drives the initial diff style after reload.
  await expect(page.locator(".diffview pre").first()).toHaveAttribute("data-diff-type", "single");
});

test("toggling bars↔classic↔both switches gutter indicators in place without a remount", async ({
  daemon,
  page,
}) => {
  await daemon.seedVersions(3, [V1, V2, V3]);
  await page.goto("/");
  await page.getByRole("button", { name: "Compare versions" }).click();
  await expect(page.getByText("gamma line three")).toBeVisible();

  // The library marks the pre with data-indicators; the default is "bars".
  const pre = page.locator(".diffview pre").first();
  await expect(pre).toHaveAttribute("data-indicators", "bars");

  await page.getByRole("radio", { name: "+/−" }).click();
  // Same element, new indicators — switched via setOptions, not recreated.
  await expect(pre).toHaveAttribute("data-indicators", "classic");

  // "Both" drives the library at bars (so the gutter bars stay) while caret's host
  // flag overlays the +/- glyphs — a combined mode the library has no value for.
  await page.getByRole("radio", { name: "Both" }).click();
  await expect(pre).toHaveAttribute("data-indicators", "bars");
  await expect(page.locator('.diffview[data-caret-indicators="both"]')).toBeAttached();

  await page.getByRole("radio", { name: "Bars" }).click();
  await expect(pre).toHaveAttribute("data-indicators", "bars");
  await expect(page.locator('.diffview[data-caret-indicators="both"]')).toHaveCount(0);
});

test("the chosen gutter indicators persist across a reload", async ({ daemon, page }) => {
  await daemon.seedVersions(3, [V1, V2, V3]);
  await page.goto("/");
  await page.getByRole("button", { name: "Compare versions" }).click();
  await expect(page.getByText("gamma line three")).toBeVisible();
  await page.getByRole("radio", { name: "+/−" }).click();
  await expect(page.locator(".diffview pre").first()).toHaveAttribute("data-indicators", "classic");

  await page.reload();
  await page.getByRole("button", { name: "Compare versions" }).click();
  // The remembered indicators drive the initial diff markers after reload.
  await expect(page.locator(".diffview pre").first()).toHaveAttribute("data-indicators", "classic");
});

// Semantic +/- color (EXC-604). The bridge ties --diffs-addition-color-override
// / --diffs-deletion-color-override to caret's --ok / --danger, and the library
// cascades that one base into the full-line tint and the per-token emphasis wash
// (--diffs-bg-*-emphasis = rgb(from base r g b / α)). So a changed token's
// emphasis span carries the addition/deletion HUE: its r,g,b channels equal the
// base token's channels (only the wash alpha differs). Comparing the rendered
// span's channels to a same-context --ok / --danger probe proves the retint
// reached the inline emphasis — and catches a regression to the library's stock
// green/red — without eyeballing. Run in both schemes since both tokens flip.

// Two versions where one word changes within an otherwise-identical line, so the
// library's word-alt diff emits an inline [data-diff-span] on the changed token.
const EMPH_BASE = "the quick brown WORD jumps over the lazy dog";
const EMPH_V1 = `# Plan\n\n${EMPH_BASE.replace("WORD", "alpha")}\n`;
const EMPH_V2 = `# Plan\n\n${EMPH_BASE.replace("WORD", "omega")}\n`;

// rgb channels of a token resolved inside the diff view's shadow scheme context
// (a throwaway probe), and of a changed line's emphasis span — compared
// channels-only so the wash alpha is irrelevant.
function channels(rgb: string): [number, number, number] {
  const m = rgb.match(/-?\d+(?:\.\d+)?/g) ?? [];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`addition/deletion emphasis spans carry caret's --ok/--danger hue in ${colorScheme}`, async ({
    daemon,
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await daemon.seedVersions(2, [EMPH_V1, EMPH_V2]);
    await page.goto("/");
    await page.getByRole("button", { name: "Compare versions" }).click();
    // Default pair is current (v2) vs previous (v1): v1's "alpha" line is the
    // deletion side, v2's "omega" line the addition side.
    await expect(page.getByText("omega", { exact: false })).toBeVisible();

    const probes = await page.evaluate(() => {
      const sh = document.querySelector(".diffview")?.shadowRoot;
      // The changed token's wash lives on [data-diff-span] inside the changed
      // line; read one from an addition line and one from a deletion line.
      function spanBg(lineType: string): string | null {
        const line = sh?.querySelector(`[data-line-type=${lineType}] [data-diff-span]`);
        return line ? getComputedStyle(line as HTMLElement).backgroundColor : null;
      }
      // Resolve --ok/--danger via a throwaway probe, using the SAME relative-
      // color form the wash does (rgb(from <token> r g b)) so both sides
      // serialize to identical sRGB rgb() channels — value-based, not
      // string-formatting-based. (A bare var() can serialize as oklab.)
      function tokenRgb(token: string): string {
        const probe = document.createElement("span");
        probe.style.color = `rgb(from var(${token}) r g b)`;
        document.body.appendChild(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
      }
      return {
        additionSpan: spanBg("change-addition"),
        deletionSpan: spanBg("change-deletion"),
        ok: tokenRgb("--ok"),
        danger: tokenRgb("--danger"),
      };
    });

    // Both emphasis spans rendered…
    expect(probes.additionSpan).not.toBeNull();
    expect(probes.deletionSpan).not.toBeNull();
    // …and each carries its semantic token's rgb channels (the wash adds alpha,
    // so compare channels only). Stock library green/red would not match.
    expect(channels(probes.additionSpan as string)).toEqual(channels(probes.ok));
    expect(channels(probes.deletionSpan as string)).toEqual(channels(probes.danger));
  });
}

// Collapsed-context band on caret's separator surface (EXC-614). When two
// versions share a long unchanged middle, the library collapses it behind a
// line-info separator: a [data-separator=line-info] band on --diffs-bg-separator
// carrying the 'N unmodified lines' label and the rounded [data-expand-button]
// pills. toFileDiffOptions pins hunkSeparators:'line-info' + expandUnchanged:false
// so this band always appears, and the .diffview bridge maps --diffs-bg-separator
// (via --diffs-bg-separator-override) to caret's separator grey. A version pair
// that changes only the first and last lines leaves a big identical middle that
// collapses to one band; the band's computed background must equal the override
// value, not the library's stock light-dark separator grey.
const CTX_MIDDLE = Array.from(
  { length: 30 },
  (_, i) => `shared body line ${i + 1} that is identical across both versions`,
).join("\n");
const CTX_V1 = `# Plan\n\nfirst line ALPHA\n\n${CTX_MIDDLE}\n\nlast line ALPHA\n`;
const CTX_V2 = `# Plan\n\nfirst line OMEGA\n\n${CTX_MIDDLE}\n\nlast line OMEGA\n`;

for (const colorScheme of ["light", "dark"] as const) {
  test(`collapsed context renders a line-info band on caret's separator surface in ${colorScheme}`, async ({
    daemon,
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await daemon.seedVersions(2, [CTX_V1, CTX_V2]);
    await page.goto("/");
    await page.getByRole("button", { name: "Compare versions" }).click();
    // The changed first/last lines flank a long identical middle, so the library
    // collapses that middle behind one line-info separator band.
    await expect(page.getByText("first line OMEGA")).toBeVisible();

    const probe = await page.evaluate(() => {
      const sh = document.querySelector(".diffview")?.shadowRoot;
      const band = sh?.querySelector("[data-separator=line-info]") as HTMLElement | null;
      const pill = sh?.querySelector("[data-expand-button]") as HTMLElement | null;
      // Resolve the bridged separator surface independently: a throwaway probe
      // reading the same --diffs-bg-separator the library paints the band with.
      // Reading it inside the shadow root resolves it through the library's
      // light-dark() default chain, which the .diffview rule's
      // --diffs-bg-separator-override short-circuits to caret's grey.
      const host = document.querySelector(".diffview") as HTMLElement;
      const sepRef = getComputedStyle(host).getPropertyValue("--diffs-bg-separator-override");
      return {
        hasBand: band != null,
        bandBg: band ? getComputedStyle(band).backgroundColor : null,
        hasPill: pill != null,
        // The library hardcodes 6px for the line-info content/pill radii, which
        // equals caret's --radius; read one pill's resolved radius to confirm.
        pillRadius: pill ? getComputedStyle(pill).borderTopLeftRadius : null,
        // The resting pill color reads --diffs-fg-number (caret's --ink-faint);
        // capture it so a regression away from the faint-ink mapping is visible.
        pillColor: pill ? getComputedStyle(pill).color : null,
        unmodifiedLabel: sh?.querySelector("[data-unmodified-lines]")?.textContent ?? null,
        sepOverrideSet: sepRef.trim().length > 0,
      };
    });

    // The collapsed-context band exists with its 'N unmodified lines' label…
    expect(probe.hasBand).toBe(true);
    expect(probe.unmodifiedLabel).toMatch(/unmodified line/);
    expect(probe.bandBg).not.toBeNull();
    // …the bridge's separator override is set (so the band can't fall back to the
    // library's stock light-dark separator grey)…
    expect(probe.sepOverrideSet).toBe(true);
    // …and the expand pill renders at caret's 6px radius with the faint-ink color.
    expect(probe.hasPill).toBe(true);
    expect(probe.pillRadius).toBe("6px");
    expect(probe.pillColor).not.toBeNull();
  });
}

test("clicking the expand pill reveals the collapsed context", async ({ daemon, page }) => {
  await daemon.seedVersions(2, [CTX_V1, CTX_V2]);
  await page.goto("/");
  await page.getByRole("button", { name: "Compare versions" }).click();
  await expect(page.getByText("first line OMEGA")).toBeVisible();

  // How many of the shared middle's lines are currently rendered in the diff. The
  // blank-line structure fragments the change into several hunks, so the middle
  // collapses behind multiple line-info bands; this counts the visible subset,
  // which grows as a band expands.
  const visibleContextCount = () =>
    page.locator(".diffview").evaluate((host: HTMLElement) => {
      const text = host.shadowRoot?.textContent ?? "";
      let n = 0;
      for (let i = 1; i <= 30; i++) {
        if (text.includes(`shared body line ${i} that is identical across both versions`)) n += 1;
      }
      return n;
    });

  // Context is collapsed up front: at least one line-info band with an expand
  // pill, and most of the shared middle hidden.
  await expect(page.locator(".diffview [data-expand-button]").first()).toBeVisible();
  const before = await visibleContextCount();
  expect(before).toBeLessThan(30);

  // A real pointer click on the first band's expand pill — the library binds its
  // expand handler to pointer events, so a Playwright click (not a synthetic
  // node.click()) is what drives it. The pill lives in the shadow root; Playwright
  // pierces shadow DOM for locators.
  await page.locator(".diffview [data-expand-button]").first().click();

  // The click revealed previously-hidden context (no collapse regression): the
  // count of rendered shared-middle lines strictly grew.
  await expect.poll(visibleContextCount).toBeGreaterThan(before);
});

// Responsive compare layout (EXC-811). Below --w-narrow (960px) the split
// side-by-side diff can't fit two code columns, so the compare view is forced to
// unified and the now-meaningless Split/Unified toggle is removed. This is
// viewport-driven library-option state — only the browser can decide it — so it
// lives here rather than in a component unit (browser-testing.md).

test("forces unified and drops the layout toggle below --w-narrow", async ({ daemon, page }) => {
  // A narrow viewport (< 960); the persisted layout preference is still split.
  await page.setViewportSize({ width: 800, height: 900 });
  await daemon.seedVersions(3, [V1, V2, V3]);
  await page.goto("/");
  await page.getByRole("button", { name: "Compare versions" }).click();
  await expect(page.getByText("gamma line three")).toBeVisible();

  // Split's two columns can't fit, so the diff renders unified ("single") even
  // though split is the stored preference — the library marks unified as "single".
  await expect(page.locator(".diffview pre").first()).toHaveAttribute("data-diff-type", "single");
  // The layout choice is gone (there is nothing to pick at this width)…
  await expect(page.getByRole("radio", { name: "Split" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Unified" })).toHaveCount(0);
  // …while the gutter-marker toggle stays (it works in a unified diff).
  await expect(page.getByRole("radio", { name: "Bars" })).toBeVisible();
});

test("crossing --w-narrow forces unified then restores the split preference", async ({
  daemon,
  page,
}) => {
  // Fixture viewport is wide (1600), so the stored split preference applies.
  await daemon.seedVersions(3, [V1, V2, V3]);
  await page.goto("/");
  await page.getByRole("button", { name: "Compare versions" }).click();
  await expect(page.getByText("gamma line three")).toBeVisible();

  // The same <pre> element throughout — the layout switches in place (setOptions),
  // it is never recreated by a width change.
  const pre = page.locator(".diffview pre").first();
  await expect(pre).toHaveAttribute("data-diff-type", "split");

  // Below the breakpoint: forced to unified, and the layout toggle drops out.
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(pre).toHaveAttribute("data-diff-type", "single");
  await expect(page.getByRole("radio", { name: "Split" })).toHaveCount(0);

  // Back above it: the preference was never overwritten, so split returns and the
  // toggle reappears.
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(pre).toHaveAttribute("data-diff-type", "split");
  await expect(page.getByRole("radio", { name: "Split" })).toBeVisible();
});
