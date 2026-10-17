// Comment bodies are user-authored and injected with Svelte's {@html ...}, so
// this render's output MUST be sanitized.
//
// The sanitizer is js-xss, not DOMPurify: DOMPurify needs a real browser DOM and
// silently mis-sanitizes under the test harness's happy-dom (it left `<script>`
// intact in a probe), so the unit suite would not exercise what actually runs.
import { Marked } from "marked";
import { filterXSS, getDefaultWhiteList } from "xss";

// breaks: a lone newline is a line break, matching the `white-space: pre-wrap`
// display this replaced and how comment fields elsewhere (e.g. GitHub) behave.
const marked = new Marked({ gfm: true, breaks: true });

export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false }) as string;
  // This whitelist already covers the tags marked emits: unknown tags are
  // escaped, inline handlers dropped, javascript:/vbscript:/data: URIs stripped.
  return filterXSS(html, { whiteList: htmlWhiteList() });
}

/** The raw HTML comment bodies keep, which the plan preview narrows: widening it widens
 * both. A fresh copy per call, so one caller's narrowing never leaks into the other's. */
export function htmlWhiteList() {
  return getDefaultWhiteList();
}
