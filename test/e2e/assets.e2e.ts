// Multi-asset pipeline over the wire: the daemon serves the standard Vite build
// (index.html + content-hashed /assets/*) cleanly, and shiki's grammars arrive
// as separate code-split chunks fetched over the wire. The fixture daemon serves
// the real ui/dist/ tree through the same asset seam the binary uses, so a green
// run here proves the hashed-asset build is served end-to-end with no broken
// references.
//
// This is a daemon-and-wire test before it is a browser test: the claim is
// about the response statuses and code-split chunk URLs the daemon produces
// while serving the built tree, plus the console errors that load raises —
// none of which a mounted component can be handed as props, and a unit would
// have to stub the very transport this exists to prove. The browser half is
// only that the entry bundle executed and a grammar chunk applied, both read as
// painted output. There is deliberately no pure half to split out.

import { expect, test } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

// Same-origin only: the index links external Google Fonts (a separate CDN
// origin), whose reachability is not what this spec proves and would make the
// "zero failed requests" assertion network-dependent. We scope every failure
// and asset check to the daemon's own origin — the multi-asset pipeline.
function isSameOrigin(url: string, origin: string): boolean {
  return url.startsWith(`${origin}/`);
}

test("daemon serves the hashed-asset build with zero failed same-origin requests", async ({
  daemon,
  page,
}) => {
  const origin = daemon.url;

  // Collect every failure signal observed during the load: a transport-level
  // requestfailed and any same-origin response with an HTTP error status.
  const failures: string[] = [];
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (isSameOrigin(url, origin)) failures.push(`requestfailed ${url}`);
  });
  page.on("response", (res) => {
    const url = res.url();
    if (isSameOrigin(url, origin) && res.status() >= 400) {
      failures.push(`${res.status()} ${url}`);
    }
  });

  // Console errors are their own failure surface — a broken module or a missing
  // asset surfaces here even when the network request itself "succeeded".
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // Record the 2xx asset responses so we can assert the build's shape: at least
  // one hashed JS entry chunk and one hashed CSS file were served.
  const okJs: string[] = [];
  const okCss: string[] = [];
  page.on("response", (res) => {
    const path = new URL(res.url()).pathname;
    if (!isSameOrigin(res.url(), origin) || res.status() !== 200) return;
    if (/^\/assets\/.+\.js$/.test(path)) okJs.push(path);
    if (/^\/assets\/.+\.css$/.test(path)) okCss.push(path);
  });

  await daemon.seed();
  await page.goto("/");

  // The plan painting confirms the entry bundle executed; web-first assertion
  // absorbs hydration timing.
  const plan = await planSurface(page);
  await expect(plan.getByText("Widget Cache Refactor")).toBeVisible();

  // A hashed JS bundle and a hashed CSS file were served from /assets/ — the
  // standard multi-asset build, not a single inlined document.
  expect(okJs.length).toBeGreaterThan(0);
  expect(okCss.length).toBeGreaterThan(0);

  // No same-origin request failed and no console error fired during the load.
  expect(failures).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("a code-split shiki grammar chunk is served over the wire and applies", async ({
  daemon,
  page,
}) => {
  const origin = daemon.url;

  // The entry bundle is index-*.js; the grammars are separate code-split chunks
  // (markdown-*.js, typescript-*.js, …) the build carves out of the initial
  // payload. The source view's highlighter fetches them as hashed /assets/*.js
  // distinct from index-*, and painting the plan source confirms a grammar chunk
  // loaded and applied.
  const grammarChunks: string[] = [];
  page.on("response", (res) => {
    if (res.status() !== 200) return;
    const path = new URL(res.url()).pathname;
    if (!isSameOrigin(res.url(), origin)) return;
    // A hashed /assets/*.js chunk that is NOT the index entry bundle: a
    // code-split grammar chunk.
    if (/^\/assets\/.+\.js$/.test(path) && !/^\/assets\/index-/.test(path)) {
      grammarChunks.push(path);
    }
  });

  // The grammar chunks fetch after first paint, off the critical path — past
  // test 1's heading-visibility failure window. Watch for failures here so a
  // 404 on ANY grammar chunk (not just the visible ts one) is caught over the
  // wire: the highlighter awaits all grammars at build, so by the repaint below
  // every chunk's request has resolved.
  const failures: string[] = [];
  page.on("requestfailed", (req) => {
    if (isSameOrigin(req.url(), origin)) failures.push(`requestfailed ${req.url()}`);
  });
  page.on("response", (res) => {
    if (isSameOrigin(res.url(), origin) && res.status() >= 400) {
      failures.push(`${res.status()} ${res.url()}`);
    }
  });

  await daemon.seed();
  await page.goto("/");

  // The source view's Shiki highlighter resolves and paints the markdown source
  // (and the fixture's fenced ts block) with caret's theme. A token carrying the
  // per-token light variable inside the library's shadow root is the web-first
  // signal that the grammar chunk loaded and applied — it absorbs the async
  // import + init without a fixed sleep.
  await planSurface(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const shadow = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
        return shadow?.querySelector("[style*='--diffs-token-light']") != null;
      }),
    )
    .toBe(true);

  // A code-split grammar chunk distinct from the entry bundle was fetched 200
  // over the wire during the highlighter build, and the paint above confirms
  // it applied.
  expect(grammarChunks.length).toBeGreaterThan(0);

  // No grammar chunk (nor any other same-origin request) failed during the load.
  expect(failures).toEqual([]);
});
