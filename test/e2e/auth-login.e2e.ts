// Token login: opening caret's `?token=` link trades the token for a cookie, and the
// UI then loads and talks to its own API on that cookie alone. The redirect that
// strips the token from the address bar and the browser's cookie jar carrying the
// credential on every later request are real-browser behaviour, so this is e2e. The
// gate's pure half — credential matching, the redirect target, the 401 bodies — is
// unit-tested in test/core/daemon/auth.test.ts.

import { expect, test } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

test.use({ auth: true });

test("the login link sets the auth cookie and loads the review", async ({
  daemon,
  page,
  playwright,
}) => {
  await daemon.seed();
  const port = new URL(daemon.url).port;

  const apiStatuses: number[] = [];
  page.on("response", (res) => {
    if (new URL(res.url()).pathname.startsWith("/api/")) apiStatuses.push(res.status());
  });

  await page.goto(`/?token=${encodeURIComponent(daemon.token ?? "")}`);
  expect(page.url()).not.toContain("token=");

  const cookie = (await page.context().cookies()).find((c) => c.name === `caret-auth-${port}`);
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  expect(cookie?.expires ?? 0).toBeGreaterThan(0);

  const plan = await planSurface(page);
  await expect(plan.getByText("Widget Cache Refactor")).toBeVisible();
  expect(apiStatuses.length).toBeGreaterThan(0);
  expect(apiStatuses.every((s) => s === 200)).toBe(true);

  const anonymous = await playwright.request.newContext({ baseURL: daemon.url });
  try {
    expect((await anonymous.get("/api/health")).status()).toBe(401);
    expect((await anonymous.get("/")).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
});
