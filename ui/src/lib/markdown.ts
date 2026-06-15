// Render a stored comment's markdown source to sanitized HTML for display in the
// annotation card. The composer stores literal markdown text; this is the
// read-side render. Comment bodies are user-authored and injected with Svelte's
// {@html ...}, so the output MUST be sanitized.
//
// Sanitizer choice: js-xss (filterXSS), not DOMPurify. DOMPurify needs a real
// browser DOM and silently mis-sanitizes under the test harness's happy-dom
// (it left `<script>` intact in a probe), so what we'd test would not be what
// runs. js-xss is a pure-string sanitizer with no DOM dependency, so its
// behavior is identical in the unit suite and the real Chromium build — the
// sanitization is therefore actually verifiable (see markdown.test.ts).
import { Marked } from "marked";
import { filterXSS } from "xss";

// breaks: true treats a single newline as a line break, matching how the plain
// `white-space: pre-wrap` display read before and how comment fields elsewhere
// (e.g. GitHub) behave. gfm: true enables fenced code, lists, and tables.
const marked = new Marked({ gfm: true, breaks: true });

export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false }) as string;
  // filterXSS's default whitelist already covers the tags marked emits for our
  // constructs (code, pre, strong, em, ul/ol/li, blockquote, h1–h6, a, table…),
  // escapes unknown tags (e.g. <script>), drops inline event handlers, and
  // strips unsafe URI schemes (javascript:, vbscript:, data:) from href/src.
  return filterXSS(html);
}
