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
 * `CommentNavigator.svelte`'s own `rows()` reads `.nav-item`, deliberately the
 * union of the inert `<li>` rows and the revealable ones' `<button>`; that union
 * has no role that names it, so the class is the component's contract rather than
 * a styling hook. Scoped to a navigator locator so it cannot reach a second panel. */
export function rows(navigator: Locator): Locator {
  return navigator.locator(".nav-item");
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
