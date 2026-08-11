// Shared locators for the review chrome — the surfaces around the plan that
// several specs address: the comment navigator, the status strip's tally, the
// discard confirmation, and the breadcrumbs bar. Each is queried by the role and
// accessible name the component already publishes, so a styling refactor cannot
// red a spec (typescript-rules.md § Shared-helper policy: one idiom, one home).

import type { Locator, Page } from "@playwright/test";

/** The comment navigator panel. `CommentNavigator.svelte` labels the aside with its
 * header title, which is "Comments" plus a version range while comparing — so the
 * name matches as a substring and holds in both modes. */
export function commentNavigator(page: Page): Locator {
  return page.getByRole("complementary", { name: "Comments" });
}

/** The review switcher's trigger (`ReviewSwitcher.svelte`). It names itself
 * "Switch review" rather than letting the name come from its content, which would
 * be the active plan's title concatenated with the pending count — fixture data on
 * both halves, and nothing saying the control is a switcher. The count rides the
 * trigger's accessible description instead ("N reviews pending"). */
export function reviewSwitcher(page: Page): Locator {
  return page.getByRole("button", { name: "Switch review" });
}

/** The status strip's comment tally, which is also the navigator's toggle. Its
 * accessible name is the count and the noun ("3 comments"); the shortcut cap beside
 * them is aria-hidden, so it stays out. */
export function commentTally(page: Page): Locator {
  return page.getByRole("button", { name: /^\d+ comments?$/ });
}

/** The discard confirmation bubble (`ConfirmPopover.svelte`), named by the question
 * it asks. Playwright's `getByRole("dialog")` does not match `role="alertdialog"`,
 * so the sibling dialogs' locator does not work here. */
export function discardConfirm(page: Page): Locator {
  return page.getByRole("alertdialog", { name: "Discard this comment?" });
}

/** The navigator's rows, in filtered order — the roving-focus targets for j/k.
 * `CommentNavigator.svelte`'s own `rows()` reads `[data-nav-row]`, deliberately
 * the union of the inert `<li>` rows and the revealable ones' `<button>`; that
 * union has no role that names it, so the attribute states the contract in the
 * markup rather than leaving it resting on a styling class (EXC-1057). Scoped to
 * a navigator locator so it cannot reach a second panel. */
export function rows(navigator: Locator): Locator {
  return navigator.locator("[data-nav-row]");
}

/** The Request Changes dialog's committed inline comments, one `listitem` each.
 * `RequestChangesDialog.svelte` renders both row groups as real lists, so a screen
 * reader gets a count and a position and a spec gets a role to bind to (EXC-1057).
 * The lists themselves are unnamed — the enclosing `<section aria-labelledby>` is
 * already the named region, and both are mounted at once while a comment is being
 * demoted, so the region is what separates them. Its name carries the section's
 * tally, hence the substring match.
 *
 * A per-row action queried inside one of these needs `exact: true`: the row's own
 * disclosure trigger takes its name from the comment text, and `name` matches on
 * substring by default, so a comment reading "discard this draft" would otherwise
 * collect the trigger alongside the Discard button. */
export function inlineRows(dialog: Locator): Locator {
  return dialog.getByRole("region", { name: "Inline comments" }).getByRole("listitem");
}

/** The Request Changes dialog's unsent composer scratches, one `listitem` each —
 * same shape as `inlineRows`, including its `exact: true` caveat. */
export function unsentRows(dialog: Locator): Locator {
  return dialog.getByRole("region", { name: "Unsent comments" }).getByRole("listitem");
}

/** The alert host's live regions. Scoped to the host because `role="status"` is
 * also carried by the safe-mode toast, the drag readout, and the file preview's
 * range — an unscoped query would couple this to all of them. */
export function alerts(page: Page): Locator {
  return page.locator(".alert-host").getByRole("status");
}

/** The breadcrumbs bar (`Breadcrumb.Root aria-label="Plan location"`). */
export function planLocation(page: Page): Locator {
  return page.getByRole("navigation", { name: "Plan location" });
}

/** The heading crumbs. Scoped by class rather than by role because the bar also
 * holds the elision marker, which is a real button with its own accessible name
 * ("More") — `getByRole("button")` here would collect it the moment the trail is
 * too wide to show whole. */
export function crumbs(page: Page): Locator {
  return planLocation(page).locator("button.crumb");
}

/** The crumb for the heading the reader is parked on. Keyed on `aria-current`,
 * which is what `PlanBreadcrumbs.svelte` itself reads rather than the `.current`
 * class it renders alongside. */
export function currentCrumb(page: Page): Locator {
  return crumbs(page).and(page.locator('[aria-current="location"]'));
}
