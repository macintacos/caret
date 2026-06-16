// Table-of-contents active-heading tracking and slug deep-linking (EXC-641).
// Clicking a ToC entry must highlight THAT entry — not the one above it. The bug
// only surfaces once a jumped heading parks below the container's top edge with a
// rendered row above it, so the fixture is deliberately tall enough to scroll. The
// URL mirrors the active header by slug (?heading=<slug>), and a ?heading= deep
// link scrolls that header into view on load.

import { expect, test } from "./support/fixtures.ts";

// Long filler keeps each section taller than the viewport, so clicking a lower
// heading genuinely scrolls it to the top rather than leaving the whole plan in
// view (where every heading would read as "active" from line one).
const filler = (label: string) =>
  Array.from(
    { length: 30 },
    (_, i) => `${label} detail line ${i + 1} keeps this section tall.`,
  ).join("\n");
const TALL_PLAN = [
  "# Alpha",
  filler("Alpha"),
  "## Bravo",
  filler("Bravo"),
  "## Charlie",
  filler("Charlie"),
  "## Delta",
  filler("Delta"),
  "## Echo",
  filler("Echo"),
  "",
].join("\n\n");

test("clicking a ToC entry highlights that entry, not the one above it", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: TALL_PLAN });
  await page.goto("/");

  const toc = page.locator(".source-toc");
  await expect(toc).toBeVisible();

  await toc.getByRole("button", { name: "Charlie", exact: true }).click();

  // The clicked entry is the active one. Before the fix this highlighted "Bravo".
  await expect(toc.getByRole("button", { name: "Charlie", exact: true })).toHaveAttribute(
    "aria-current",
    "location",
  );
  await expect(toc.getByRole("button", { name: "Bravo", exact: true })).not.toHaveAttribute(
    "aria-current",
    "location",
  );

  // The URL reflects the active header by slug, not a raw line number.
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("charlie");
});

test("opening a ?heading=<slug> URL scrolls that header into view", async ({ daemon, page }) => {
  const id = await daemon.seed({ plan: TALL_PLAN });
  await page.goto(`/?review=${id}&heading=delta`);

  const toc = page.locator(".source-toc");
  // The deep-linked header becomes the active entry once its row is scrolled in.
  await expect(toc.getByRole("button", { name: "Delta", exact: true })).toHaveAttribute(
    "aria-current",
    "location",
  );
});
