// Version compare on the source-view surface (EXC-576). With two or more stored
// versions, a picker lets the reviewer diff any pair, side-by-side or stacked,
// switching the layout at runtime without remounting the view or losing scroll.
// The control is hidden for single-version reviews, and the chosen layout
// persists across reloads.

import { expect, test } from "./support/fixtures.ts";

// Three versions whose bodies each carry a unique, greppable line so a diff
// between a chosen pair is verifiable by visible text.
const V1 = "# Plan\n\nalpha line one\n";
const V2 = "# Plan\n\nbeta line two\n";
const V3 = "# Plan\n\ngamma line three\n";

test("the compare control is hidden for a single-version review", async ({ daemon, page }) => {
  await daemon.seed({ plan: V1 });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.locator(".compare-picker")).toHaveCount(0);
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
  await page.locator(".target-select").selectOption("1");

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

  await page.getByRole("button", { name: "Unified" }).click();
  // Same element, new layout — switched via setOptions, not recreated.
  await expect(pre).toHaveAttribute("data-diff-type", "single");

  await page.getByRole("button", { name: "Split" }).click();
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
  await page.getByRole("button", { name: "Unified" }).click();
  await expect(page.locator(".diffview pre").first()).toHaveAttribute("data-diff-type", "single");
  expect(await view.evaluate((el) => el.scrollTop)).toBe(before);
});

test("the chosen layout persists across a reload", async ({ daemon, page }) => {
  await daemon.seedVersions(3, [V1, V2, V3]);
  await page.goto("/");
  await page.getByRole("button", { name: "Compare versions" }).click();
  await expect(page.getByText("gamma line three")).toBeVisible();
  await page.getByRole("button", { name: "Unified" }).click();
  await expect(page.locator(".diffview pre").first()).toHaveAttribute("data-diff-type", "single");

  await page.reload();
  await page.getByRole("button", { name: "Compare versions" }).click();
  // The remembered layout drives the initial diff style after reload.
  await expect(page.locator(".diffview pre").first()).toHaveAttribute("data-diff-type", "single");
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
