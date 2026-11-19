// The keyboard cursor stops on comments: j/k land on each comment card and each Resume
// marker between the lines, on the source view and on the preview, and every other motion
// lands on a line.
//
// What needs a real browser here: real keystrokes through the global dispatcher, the
// focused card and line band as painted, the follow scroll over a card's measured box,
// expanded cards, and real pointer hover. The pure half stays units: stop order, crossing
// and neighbours in ui/src/lib/diffview/commentStops.test.ts, the cursor factories'
// stepping in ui/src/state/planKeyboard.test.ts and ui/src/state/previewCursor.test.ts,
// the tall-box top alignment in ui/src/lib/diffview/scroll.test.ts, and landing when the
// hovered comment goes in ui/src/components/DiffPlanView.test.ts.

import type { Locator, Page } from "@playwright/test";

import {
  commentNavigator,
  commentTally,
  discardConfirm,
  rows,
  sourceToggle,
} from "@test/e2e/support/chrome.ts";
import { cursor, previewCursor } from "@test/e2e/support/cursor.ts";
import { type Daemon, expect, test } from "@test/e2e/support/fixtures.ts";
import {
  awaitPlanReadyForKeys,
  lineOf,
  PLAN_PREVIEW,
  PLAN_SURFACE,
} from "@test/e2e/support/source-view.ts";

const PLAN = [
  "# Stops",
  "",
  "Alpha line.",
  "",
  "Bravo line.",
  "",
  "Charlie line.",
  "",
  "## Next",
  "",
  "Delta line.",
  "",
  "Echo line.",
  "",
  "Foxtrot line.",
  "",
].join("\n");

type View = "source" | "preview";
type Draft = (line: (text: string) => number) => Parameters<Daemon["putDraft"]>[1];

/** A cursor on the plan: the line of the row reading `text`, and where `j` off a stop
 * that renders after that row lands — the next line on source, the next paragraph's
 * first line on the preview. */
interface Lines {
  at: (text: string) => number;
  past: (text: string, next: string) => number;
}

/** Seed PLAN, anchor `draft` to its rendered lines by their text, reload, and open `view`
 * ready for keys. */
async function open(
  page: Page,
  daemon: Daemon,
  view: View,
  draft: Draft,
  versions = 1,
): Promise<Lines> {
  const id =
    versions > 1
      ? await daemon.seedVersions(versions, Array(versions).fill(PLAN))
      : await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await awaitPlanReadyForKeys(page);
  const lines = new Map<string, number>();
  for (const text of PLAN.split("\n").filter((t) => t.endsWith("line."))) {
    lines.set(text, await lineOf(page, text));
  }
  const at = (text: string) => lines.get(text) ?? -1;
  await daemon.putDraft(id, draft(at));
  await page.reload();
  await awaitPlanReadyForKeys(page);
  if (view === "preview") {
    await sourceToggle(page).click();
    await expect(page.locator(PLAN_PREVIEW)).toBeVisible();
  }
  return { at, past: (text, next) => (view === "source" ? at(text) + 1 : at(next)) };
}

const comment = (id: string, line: number, text = `note ${id}`) => ({
  id,
  startLine: line,
  endLine: line,
  comment: text,
});

const card = (page: Page, id: string): Locator => page.locator(`[data-annotation-card="${id}"]`);
const marker = (page: Page): Locator => page.locator("[data-scratch-marker]");
const lineCursor = (page: Page, view: View): Locator =>
  view === "source" ? cursor(page) : previewCursor(page);

/** Put the line cursor on the line reading `text`, through a committed search. */
async function toLine(page: Page, text: string): Promise<void> {
  await page.keyboard.press("/");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
}

async function expectOnLine(page: Page, view: View, line: number): Promise<void> {
  await expect(lineCursor(page, view)).toHaveAttribute("data-line", String(line));
}

async function expectOnCard(page: Page, view: View, id: string): Promise<void> {
  await expect(card(page, id)).toHaveClass(/\bfocused\b/);
  await expect(lineCursor(page, view)).toHaveCount(0);
}

for (const view of ["source", "preview"] as const) {
  test.describe(`on the ${view}`, () => {
    test("j from a comment's last line hovers it, and k from the next line", async ({
      daemon,
      page,
    }) => {
      const lines = await open(page, daemon, view, (line) => ({
        annotations: [comment("b", line("Bravo line."))],
      }));
      await toLine(page, "Bravo");
      await expectOnLine(page, view, lines.at("Bravo line."));

      await page.keyboard.press("j");
      await expectOnCard(page, view, "b");
      await page.keyboard.press("j");
      await expectOnLine(page, view, lines.past("Bravo line.", "Charlie line."));
      await expect(card(page, "b")).not.toHaveClass(/\bfocused\b/);
      await page.keyboard.press("k");
      await expectOnCard(page, view, "b");
    });

    test("a two-comment thread is two stops", async ({ daemon, page }) => {
      const lines = await open(page, daemon, view, (line) => ({
        annotations: [comment("b1", line("Bravo line.")), comment("b2", line("Bravo line."))],
      }));
      await toLine(page, "Bravo");
      await page.keyboard.press("j");
      await expectOnCard(page, view, "b1");
      await page.keyboard.press("j");
      await expectOnCard(page, view, "b2");
      await page.keyboard.press("j");
      await expectOnLine(page, view, lines.past("Bravo line.", "Charlie line."));
    });

    test("clicking a card focuses it, and an expanded card is one stop", async ({
      daemon,
      page,
    }) => {
      const lines = await open(page, daemon, view, (line) => ({
        annotations: [comment("b", line("Bravo line."))],
      }));
      await card(page, "b").click();
      await expect(card(page, "b")).toHaveClass(/\bexpanded\b/);
      await expectOnCard(page, view, "b");

      await page.keyboard.press("j");
      await expectOnLine(page, view, lines.past("Bravo line.", "Charlie line."));
      await page.keyboard.press("k");
      await expectOnCard(page, view, "b");
      await page.keyboard.press("k");
      await expectOnLine(page, view, lines.at("Bravo line."));
    });

    test("a Resume marker is a stop, and the open composer is not", async ({ daemon, page }) => {
      const lines = await open(page, daemon, view, (line) => ({
        composerScratches: [
          { startLine: line("Delta line."), endLine: line("Delta line."), text: "half a thought" },
        ],
      }));
      await toLine(page, "Delta");
      await page.keyboard.press("j");
      await expect(marker(page)).toHaveClass(/\bfocused\b/);
      await expect(lineCursor(page, view)).toHaveCount(0);

      // `c` on Echo opens its composer; Escape blurs its field, leaving it open.
      await toLine(page, "Echo");
      await page.keyboard.press("c");
      await expect(page.locator(".cm-content")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.locator(".cm-content")).not.toBeFocused();
      await page.keyboard.press("j");
      await expectOnLine(page, view, lines.past("Echo line.", "Foxtrot line."));
    });

    test("G, Ctrl+d and ]] leave a hovered comment for a line", async ({ daemon, page }) => {
      await open(page, daemon, view, (line) => ({
        annotations: [comment("a", line("Alpha line."))],
      }));
      for (const keys of [["G"], ["Control+d"], ["]", "]"]]) {
        await toLine(page, "Alpha");
        await page.keyboard.press("j");
        await expectOnCard(page, view, "a");
        for (const key of keys) await page.keyboard.press(key);
        await expect(lineCursor(page, view)).toHaveCount(1);
        await expect(card(page, "a")).not.toHaveClass(/\bfocused\b/);
      }
    });

    test("Escape leaves a hovered card focused", async ({ daemon, page }) => {
      await open(page, daemon, view, (line) => ({
        annotations: [comment("b", line("Bravo line."))],
      }));
      await toLine(page, "Bravo");
      await page.keyboard.press("j");
      await expectOnCard(page, view, "b");
      await page.keyboard.press("Escape");
      await expectOnCard(page, view, "b");
    });

    test("the pointer over a card focuses nothing", async ({ daemon, page }) => {
      await open(page, daemon, view, (line) => ({
        annotations: [comment("b", line("Bravo line."))],
      }));
      await commentTally(page).click();
      await expect(commentNavigator(page)).toBeVisible();
      await card(page, "b").hover();
      await expect(card(page, "b")).not.toHaveClass(/\bfocused\b/);
      await expect(rows(commentNavigator(page)).and(page.locator("[aria-current]"))).toHaveCount(0);
    });

    test("e and i open the edit composer, and saving or cancelling keeps the card focused", async ({
      daemon,
      page,
    }) => {
      await open(page, daemon, view, (line) => ({
        annotations: [comment("b", line("Bravo line."))],
      }));
      await toLine(page, "Bravo");
      await page.keyboard.press("j");
      await expect(card(page, "b")).not.toHaveClass(/\bexpanded\b/);

      await page.keyboard.press("e");
      await expect(card(page, "b").locator(".cm-content")).toBeFocused();
      // The first Escape blurs the editor into its composer; the second cancels the edit.
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(card(page, "b")).not.toHaveClass(/\bediting\b/);
      await expectOnCard(page, view, "b");

      await page.keyboard.press("i");
      await expect(card(page, "b").locator(".cm-content")).toBeFocused();
      await page.keyboard.press("End");
      await page.keyboard.type(" revised");
      await page.keyboard.press("ControlOrMeta+Enter");
      await expect(card(page, "b")).toContainText("note b revised");
      await expectOnCard(page, view, "b");
    });

    test("h and Shift+D leave an edit in progress alone once its field blurs", async ({
      daemon,
      page,
    }) => {
      await open(page, daemon, view, (line) => ({
        annotations: [comment("b", line("Bravo line."))],
      }));
      await toLine(page, "Bravo");
      await page.keyboard.press("j");
      await page.keyboard.press("e");
      await page.keyboard.press("End");
      await page.keyboard.type(" unsaved");
      await page.keyboard.press("Escape");

      await page.keyboard.press("h");
      await page.keyboard.press("D");
      await expect(card(page, "b")).toHaveClass(/\bediting\b/);
      await expect(card(page, "b").locator(".cm-content")).toHaveText("note b unsaved");

      await page.keyboard.press("Escape");
      await expect(card(page, "b")).not.toHaveClass(/\bediting\b/);
      await expect(discardConfirm(page)).toHaveCount(0);
    });

    test("Enter expands then edits, and h and l fold", async ({ daemon, page }) => {
      await open(page, daemon, view, (line) => ({
        annotations: [comment("b", line("Bravo line."))],
      }));
      await toLine(page, "Bravo");
      await page.keyboard.press("j");

      await page.keyboard.press("Enter");
      await expect(card(page, "b")).toHaveClass(/\bexpanded\b/);
      await page.keyboard.press("Enter");
      await expect(card(page, "b").locator(".cm-content")).toBeFocused();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(card(page, "b")).not.toHaveClass(/\bediting\b/);

      await page.keyboard.press("h");
      await expect(card(page, "b")).not.toHaveClass(/\bexpanded\b/);
      await page.keyboard.press("l");
      await expect(card(page, "b")).toHaveClass(/\bexpanded\b/);
    });

    test("Shift+D asks to discard: Escape keeps the card, Enter discards it", async ({
      daemon,
      page,
    }) => {
      const lines = await open(page, daemon, view, (line) => ({
        annotations: [comment("b", line("Bravo line."))],
      }));
      await toLine(page, "Bravo");
      await page.keyboard.press("j");
      await expect(card(page, "b")).not.toHaveClass(/\bexpanded\b/);

      await page.keyboard.press("D");
      await expect(discardConfirm(page)).toBeVisible();
      await expect(discardConfirm(page).getByRole("button", { name: "Discard" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(discardConfirm(page)).toHaveCount(0);
      await expectOnCard(page, view, "b");
      // Focus went back off the Discard trigger, so Enter reaches the card, not the trigger.
      await page.keyboard.press("Enter");
      await expect(card(page, "b")).toHaveClass(/\bexpanded\b/);
      await expect(discardConfirm(page)).toHaveCount(0);

      await page.keyboard.press("D");
      await expect(discardConfirm(page).getByRole("button", { name: "Discard" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(card(page, "b")).toHaveCount(0);
      await expectOnLine(page, view, lines.at("Bravo line."));
    });

    test("d toggles compare while a card is hovered", async ({ daemon, page }) => {
      await open(
        page,
        daemon,
        view,
        (line) => ({ annotations: [comment("b", line("Bravo line."))] }),
        2,
      );
      await toLine(page, "Bravo");
      await page.keyboard.press("j");
      await expectOnCard(page, view, "b");
      await page.keyboard.press("d");
      await expect(sourceToggle(page)).toHaveCount(0);
    });

    test("c adds to the hovered comment's thread, over its anchored lines", async ({
      daemon,
      page,
    }) => {
      await open(page, daemon, view, (line) => ({
        annotations: [
          {
            id: "b",
            startLine: line("Alpha line."),
            endLine: line("Bravo line."),
            comment: "note b",
          },
        ],
      }));
      await toLine(page, "Bravo");
      await page.keyboard.press("j");
      await expectOnCard(page, view, "b");

      await page.keyboard.press("c");
      await expect(page.locator(".composer .label")).toHaveText(/^Lines /);
      await page.keyboard.type("second thought");
      await page.keyboard.press("ControlOrMeta+Enter");
      await expect(page.locator("[data-annotation-card]")).toHaveCount(2);
      const fresh = page.locator("[data-annotation-card]").filter({ hasText: "second thought" });
      await expect(fresh).toHaveClass(/\bfocused\b/);
    });

    test("V starts visual mode on the hovered comment's last line", async ({ daemon, page }) => {
      const lines = await open(page, daemon, view, (line) => ({
        annotations: [comment("b", line("Bravo line."))],
      }));
      await toLine(page, "Bravo");
      await page.keyboard.press("j");
      await page.keyboard.press("V");
      await expectOnLine(page, view, lines.at("Bravo line."));
      await page.keyboard.press("c");
      await expect(page.locator(".composer .label")).toHaveText(`Line ${lines.at("Bravo line.")}`);
    });

    test("h, e and Enter off a comment do nothing", async ({ daemon, page }) => {
      const lines = await open(page, daemon, view, (line) => ({
        annotations: [comment("b", line("Bravo line."))],
      }));
      await toLine(page, "Bravo");
      for (const key of ["h", "e", "Enter"]) await page.keyboard.press(key);
      await expectOnLine(page, view, lines.at("Bravo line."));
      await expect(page.locator(".cm-content")).toHaveCount(0);
      await expect(card(page, "b")).not.toHaveClass(/\bexpanded\b/);
    });

    test("]c walks every comment and wraps, and [c wraps back", async ({ daemon, page }) => {
      await open(page, daemon, view, (line) => ({
        annotations: [comment("a", line("Alpha line.")), comment("d", line("Delta line."))],
        composerScratches: [
          { startLine: line("Charlie line."), endLine: line("Charlie line."), text: "half" },
        ],
      }));
      await toLine(page, "Alpha");
      for (const id of ["a", "d", "a"]) {
        await page.keyboard.press("]");
        await page.keyboard.press("c");
        await expectOnCard(page, view, id);
      }
      await page.keyboard.press("[");
      await page.keyboard.press("c");
      await expectOnCard(page, view, "d");
    });

    test("]c and [c do nothing on a plan without comments", async ({ daemon, page }) => {
      const lines = await open(page, daemon, view, () => ({ annotations: [] }));
      await toLine(page, "Bravo");
      for (const key of ["]", "c", "[", "c"]) await page.keyboard.press(key);
      await expectOnLine(page, view, lines.at("Bravo line."));
    });

    test("a card taller than the viewport shows its top", async ({ daemon, page }) => {
      await page.setViewportSize({ width: 1000, height: 480 });
      const long = Array.from({ length: 40 }, (_, i) => `- point ${i + 1}`).join("\n");
      const lines = await open(page, daemon, view, (line) => ({
        annotations: [comment("b", line("Bravo line."), long)],
      }));
      await card(page, "b").click();
      await expect(card(page, "b")).toHaveClass(/\bexpanded\b/);
      // The expand is a reveal: wait until the card stands taller than the plan.
      const plan = page.locator(PLAN_SURFACE);
      const planHeight = (await plan.boundingBox())?.height ?? 0;
      await expect
        .poll(async () => (await card(page, "b").boundingBox())?.height ?? 0)
        .toBeGreaterThan(planHeight);
      await page.keyboard.press("k");
      await expectOnLine(page, view, lines.at("Bravo line."));

      // Following the card's bottom would scroll its top out of view; the follow rests the
      // top at the plan's top instead.
      await page.keyboard.press("j");
      await expectOnCard(page, view, "b");
      const planTop = (await plan.boundingBox())?.y ?? 0;
      await expect
        .poll(async () => Math.round(((await card(page, "b").boundingBox())?.y ?? 0) - planTop))
        .toBe(0);
    });
  });
}

test("} after a navigator pick moves on from the picked comment", async ({ daemon, page }) => {
  const lines = await open(page, daemon, "source", (line) => ({
    annotations: [comment("d", line("Delta line."))],
  }));
  await toLine(page, "Alpha");
  await page.keyboard.press("C");
  await expect(rows(commentNavigator(page)).first()).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expectOnCard(page, "source", "d");

  await page.keyboard.press("}");
  await expectOnLine(page, "source", lines.at("Delta line.") + 1);
});

test("Enter acts on the hovered card while another card's chip holds focus", async ({
  daemon,
  page,
}) => {
  await open(page, daemon, "source", (line) => ({
    annotations: [comment("a", line("Alpha line.")), comment("d", line("Delta line."))],
  }));
  await card(page, "a").getByRole("button", { name: "Expand comment" }).click();
  await expect(card(page, "a")).toHaveClass(/\bexpanded\b/);
  await page.keyboard.press("]");
  await page.keyboard.press("c");
  await expectOnCard(page, "source", "d");

  await page.keyboard.press("Enter");
  await expect(card(page, "d")).toHaveClass(/\bexpanded\b/);
  await expect(card(page, "d")).toHaveClass(/\bfocused\b/);
  await expect(card(page, "a")).toHaveClass(/\bexpanded\b/);
});

test.describe("key caps on the hovered comment", () => {
  const caps = (page: Page, id: string): Locator => card(page, id).locator('[data-slot="kbd"]');
  const one = (line: (text: string) => number) => ({
    annotations: [comment("b", line("Bravo line."))],
  });

  test("j onto a card shows its caps", async ({ daemon, page }) => {
    await open(page, daemon, "source", one);
    await toLine(page, "Bravo");
    await page.keyboard.press("j");
    await expectOnCard(page, "source", "b");
    await expect(caps(page, "b").first()).toBeVisible();
  });

  test("a click onto a card shows none until the next key", async ({ daemon, page }) => {
    await open(page, daemon, "source", one);
    await card(page, "b").click();
    await expectOnCard(page, "source", "b");
    await expect(caps(page, "b")).toHaveCount(0);
    await page.keyboard.press("h");
    await expect(caps(page, "b").first()).toBeVisible();
  });

  test("with shortcut hints off, a card shows no caps", async ({ daemon, page }) => {
    await page.addInitScript(() => localStorage.setItem("caret.shortcutHints", "off"));
    await open(page, daemon, "source", one);
    await toLine(page, "Bravo");
    await page.keyboard.press("j");
    await expectOnCard(page, "source", "b");
    await expect(caps(page, "b")).toHaveCount(0);
  });

  test("a keyboard navigator pick shows caps, and a navigator click does not", async ({
    daemon,
    page,
  }) => {
    await open(page, daemon, "source", one);
    await page.keyboard.press("C");
    const nav = commentNavigator(page);
    await expect(rows(nav).first()).toBeFocused();
    await page.keyboard.press("Enter");
    await expectOnCard(page, "source", "b");
    await expect(caps(page, "b").first()).toBeVisible();

    await rows(nav).first().click();
    await expect(caps(page, "b")).toHaveCount(0);
  });

  test("a comment submitted with Cmd+Enter shows its caps", async ({ daemon, page }) => {
    await open(page, daemon, "source", () => ({ annotations: [] }));
    await toLine(page, "Bravo");
    await page.keyboard.press("c");
    await page.keyboard.type("fresh thought");
    await page.keyboard.press("ControlOrMeta+Enter");
    const fresh = page.locator("[data-annotation-card]").filter({ hasText: "fresh thought" });
    await expect(fresh).toHaveClass(/\bfocused\b/);
    await expect(fresh.locator('[data-slot="kbd"]').first()).toBeVisible();
  });

  for (const view of ["source", "preview"] as const) {
    test(`a hovered card's caps stay inside its thread on the ${view}`, async ({
      daemon,
      page,
    }) => {
      await page.setViewportSize({ width: 900, height: 700 });
      const long = "a long remark that runs well past the width of one clamped line ".repeat(4);
      await open(page, daemon, view, (line) => ({
        annotations: [comment("a", line("Bravo line.")), comment("b", line("Bravo line."), long)],
      }));
      await toLine(page, "Bravo");
      await page.keyboard.press("j");
      await page.keyboard.press("j");
      await expectOnCard(page, view, "b");
      const discard = card(page, "b")
        .getByRole("button", { name: "Discard comment" })
        .locator('[data-slot="kbd"]');
      await expect(discard).toBeVisible();

      const thread = page.locator('[data-slot="card"].thread').filter({ has: card(page, "b") });
      const right = async (l: Locator) => {
        const box = await l.boundingBox();
        return (box?.x ?? 0) + (box?.width ?? 0);
      };
      const edge = (await right(thread)) + 1;
      expect(await right(card(page, "a"))).toBeLessThanOrEqual(edge);
      expect(await right(card(page, "b"))).toBeLessThanOrEqual(edge);
      expect(await right(discard)).toBeLessThanOrEqual(edge);
    });
  }
});
