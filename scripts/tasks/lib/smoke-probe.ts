// The pure, HTTP-level probe shared by the `smoke bin` and `smoke bundle`
// targets: given a base URL of a running caret daemon, assert that it serves the
// multi-asset UI correctly. The daemon boot / process supervision differs
// between the two (a copied compiled binary vs. a prewarm-spawned bundle
// daemon) and lives in smoke.ts; the over-the-wire checks are identical
// and live here, driven through an injectable `fetch` so they are unit-testable.

/** Every distinct `/assets/…` URL a served index references, deduped and sorted.
 * An empty result means the served page referenced no hashed assets — for these
 * smoke tests that is itself a failure (a broken embed serves the placeholder,
 * which references none). */
export function extractAssetPaths(indexHtml: string): string[] {
  const matches = indexHtml.match(/\/assets\/[A-Za-z0-9._/-]+/g) ?? [];
  return [...new Set(matches)].sort();
}

/** Whether a Content-Type is HTML (case-insensitive, charset tolerated). */
export function isHtmlContentType(ctype: string): boolean {
  return ctype.toLowerCase().includes("text/html");
}

/** Whether an asset's Content-Type is usable — non-empty and not the generic
 * octet-stream, either of which signals the served file lost its MIME mapping. */
export function isUsableAssetContentType(ctype: string): boolean {
  const c = ctype.toLowerCase();
  return c !== "" && !c.includes("application/octet-stream");
}

export interface ProbeOptions {
  /** Prefix for every diagnostic line and thrown message, e.g. "smoke bin". */
  label: string;
  /** Require /api/health to report a production (isDev:false) install. */
  requireProduction: boolean;
  /** Parenthetical appended to the "no /assets/ URLs" failure — the two tasks
   * suspect different causes (broken embed vs. a missing shipped ui/dist). */
  emptyAssetsHint: string;
}

/** Drive the served UI over HTTP and assert it looks right: GET / is 200 HTML
 * referencing ≥1 hashed asset, every referenced asset is 200 with a usable
 * Content-Type, and /api/health identifies caret (optionally as a production
 * install). Returns the referenced asset paths on success; throws an Error whose
 * message names the failure (the caller maps that to a stderr line + exit 1). */
export async function probeServedUi(
  base: string,
  opts: ProbeOptions,
  fetchFn: typeof fetch = fetch,
): Promise<string[]> {
  const { label } = opts;

  const indexRes = await fetchFn(`${base}/`);
  if (indexRes.status !== 200) {
    throw new Error(`${label}: GET / returned ${indexRes.status} (expected 200)`);
  }
  const indexCtype = indexRes.headers.get("content-type") ?? "";
  if (!isHtmlContentType(indexCtype)) {
    throw new Error(`${label}: GET / Content-Type is '${indexCtype}' (expected text/html)`);
  }

  const body = await indexRes.text();
  const assets = extractAssetPaths(body);
  if (assets.length === 0) {
    // Dump the served page: a broken embed is hard to debug without seeing that
    // the placeholder (which references no assets) was served in its place.
    throw new Error(
      `${label}: served index references no /assets/ URLs (${opts.emptyAssetsHint})\n--- served index ---\n${body}`,
    );
  }

  for (const path of assets) {
    const res = await fetchFn(`${base}${path}`);
    if (res.status !== 200) {
      throw new Error(`${label}: asset ${path} returned ${res.status} (expected 200)`);
    }
    const ctype = res.headers.get("content-type") ?? "";
    if (!isUsableAssetContentType(ctype)) {
      throw new Error(`${label}: asset ${path} has unhelpful Content-Type '${ctype}'`);
    }
  }

  let health: { service?: unknown; isDev?: unknown } | null = null;
  try {
    health = (await (await fetchFn(`${base}/api/health`)).json()) as {
      service?: unknown;
      isDev?: unknown;
    };
  } catch {
    // A non-JSON body leaves health null → the service check below reports the
    // empty service rather than throwing on the parse.
  }
  if (health?.service !== "caret") {
    throw new Error(`${label}: /api/health service is '${health?.service ?? ""}' (expected caret)`);
  }
  if (opts.requireProduction && health?.isDev !== false) {
    throw new Error(
      `${label}: /api/health isDev is '${health?.isDev}' (expected false — the bundle is a production install)`,
    );
  }

  return assets;
}
