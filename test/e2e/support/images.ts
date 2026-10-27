// Image assets a spec serves from bytes in this file, so no request leaves the machine.
import type { Page } from "@playwright/test";

/** A 900x700 1-bit PNG, solid black — large enough that a size cap has to bind. */
export const BIG_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAA4QAAAK8AQAAAACfa0ziAAAAZElEQVR42u3BMQEAAADCoPVPbQlPoAAAAAAAAAAA" +
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
    "eBo3xwABf429cQAAAABJRU5ErkJggg==",
  "base64",
);

/** Served as a real PNG by routeAssets. */
export const GOOD = "https://assets.test/diagram.png";
/** Answered 404 by routeAssets. */
export const GONE = "https://assets.test/absent.png";

/** Serve every intercepted asset from this file: the good URL as a real PNG, the
 * missing one as a 404. Installed before the page loads so no request escapes. */
export async function routeAssets(page: Page): Promise<void> {
  await page.route(GOOD, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: BIG_PNG }),
  );
  await page.route(GONE, (route) => route.fulfill({ status: 404, body: "" }));
}
