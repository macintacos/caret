// Markdown -> sanitized HTML with structural block ids.
//
// Each block-level element gets a deterministic token-index id `id="b{n}"`
// (n increments in document order). Heading slugs live on `data-slug` so the
// single `id` slot stays reserved for the structural anchor that annotations
// reference. Annotation char offsets are measured against the block element's
// post-sanitize `textContent`, so the ids must survive sanitization.

import createDOMPurify from "dompurify";
import type { DOMPurify as DOMPurifyInstance, WindowLike } from "dompurify";
import { Marked } from "marked";
import { highlightToHtml } from "./highlight.ts";

// Matches a `style` value that contains ONLY shiki's dual-theme output: the
// `--shiki-*` custom properties (per-token `--shiki-light`/`--shiki-dark` colors,
// `--shiki-*-bg` on the <pre>, and `--shiki-*-font-style`/`-font-weight` for
// italic/bold tokens), or color / background-color derived from them. Values are
// limited to inert hex / rgb / var(--shiki…) / font keywords / weight numbers.
// Anything else (`position`, `z-index`, `url(...)`, …) fails the match and the
// whole attribute is dropped — so this narrows, never widens, the XSS surface.
const SHIKI_STYLE =
  /^(?:(?:--shiki[\w-]*|color|background-color)\s*:\s*(?:#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s%]+\)|var\(--shiki[\w-]*\)|italic|oblique|normal|bold|bolder|lighter|\d{1,3})\s*;?\s*)+$/;

// DOMPurify must bind to a `window` (happy-dom in tests, the real one in the
// browser). Bind lazily at first use so module import never requires a DOM.
let purifier: DOMPurifyInstance | null = null;
function getPurifier(): DOMPurifyInstance {
  if (purifier) return purifier;
  const win =
    (globalThis as { window?: WindowLike }).window ?? (globalThis as unknown as WindowLike);
  purifier = createDOMPurify(win);
  // Preserve shiki's token-color `style` through sanitization: keep a `style`
  // only when its whole value is shiki-shaped (SHIKI_STYLE), drop it otherwise.
  // Dangerous styles (position, url(), expression(), …) never match, so this
  // narrows — never widens — the XSS surface. Sanitize stays the terminal step.
  purifier.addHook("uponSanitizeAttribute", (_node, data) => {
    if (data.attrName === "style") {
      if (SHIKI_STYLE.test(data.attrValue.trim())) data.forceKeepAttr = true;
      else data.keepAttr = false;
    }
  });
  return purifier;
}

export interface HeadingEntry {
  level: number;
  slug: string;
  text: string;
  /** Structural id of the heading's block element, e.g. "b3". */
  blockId: string;
}

export interface RenderResult {
  html: string;
  headings: HeadingEntry[];
}

/** Block-level renderer methods that should receive a structural id. */
const BLOCK_METHODS = [
  "heading",
  "paragraph",
  "blockquote",
  "list",
  "code",
  "table",
  "hr",
] as const;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Inserts `attrs` into the first opening tag of `html`. */
function injectAttrs(html: string, attrs: string): string {
  return html.replace(/^(\s*<[a-zA-Z][\w-]*)/, `$1 ${attrs}`);
}

/**
 * Renders markdown to sanitized HTML, stamping sequential structural ids and
 * collecting the heading outline. Pure and deterministic for a given input.
 */
export function renderPlan(markdown: string): RenderResult {
  let counter = 0;
  let firstHeadingSeen = false;
  const headings: HeadingEntry[] = [];
  const usedSlugs = new Map<string, number>();

  const marked = new Marked({ gfm: true, breaks: false });

  // Wrap each block-level renderer so it stamps an id and (for headings) a slug.
  const overrides: Record<string, (token: unknown) => string> = {};
  for (const name of BLOCK_METHODS) {
    overrides[name] = function (this: { parser: unknown }, token: unknown) {
      const blockId = `b${counter++}`;

      // Normalize the plan's first heading to H1 regardless of its authored level.
      // Agents pick inconsistent top-of-file heading levels; we fix the rendered
      // view here rather than rewriting the source file. Only the first heading is
      // touched — later headings keep their authored levels. marked derives the tag
      // from `token.depth`, so mutate it before delegating to the base renderer.
      if (name === "heading" && !firstHeadingSeen) {
        (token as { depth: number }).depth = 1;
        firstHeadingSeen = true;
      }

      // Defer to the default renderer for the actual markup. `name` is always a
      // real block method, so the lookup is non-null.
      const renderers = DefaultRenderer as unknown as {
        [k: string]: (this: { parser: unknown }, t: unknown) => string;
      };
      const base = renderers[name] as (this: { parser: unknown }, t: unknown) => string;

      // Fenced code blocks are syntax-highlighted by shiki when a known language
      // is tagged. highlightToHtml returns null for an unknown/unloaded language
      // or a cold-start highlighter, so we fall back to marked's plain
      // <pre><code> then. shiki's <pre class="shiki"> stays the first tag, so the
      // id injection below still anchors on it.
      let out: string;
      if (name === "code") {
        const t = token as { text: string; lang?: string };
        const lang = (t.lang ?? "").trim().split(/\s+/)[0] || undefined;
        out = highlightToHtml(t.text, lang) ?? base.call(this, token);
      } else {
        out = base.call(this, token);
      }

      if (name === "heading") {
        const t = token as { depth: number; text: string };
        const baseSlug = slugify(t.text);
        const seen = usedSlugs.get(baseSlug) ?? 0;
        const slug = seen === 0 ? baseSlug : `${baseSlug}-${seen}`;
        usedSlugs.set(baseSlug, seen + 1);
        headings.push({ level: t.depth, slug, text: t.text, blockId });
        out = injectAttrs(out, `id="${blockId}" data-slug="${slug}"`);
      } else {
        out = injectAttrs(out, `id="${blockId}"`);
      }
      return out;
    };
  }

  marked.use({ renderer: overrides as never });

  // INVARIANT: attributes are string-injected into the raw HTML ABOVE, then the
  // whole document is sanitized HERE. Sanitize MUST remain the last step — never
  // inject id/data-slug (or anything else) after this, or it becomes an XSS hole.
  const rawHtml = marked.parse(markdown, { async: false }) as string;
  const html = getPurifier().sanitize(rawHtml, {
    ADD_ATTR: ["data-slug", "id"],
    USE_PROFILES: { html: true },
  });

  return { html, headings };
}

// A bare Marked renderer instance whose default block methods we delegate to.
// (Created once; stateless across renders.)
import { Renderer } from "marked";
const DefaultRenderer = new Renderer();
