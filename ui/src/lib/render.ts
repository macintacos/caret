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

// DOMPurify must bind to a `window` (happy-dom in tests, the real one in the
// browser). Bind lazily at first use so module import never requires a DOM.
let purifier: DOMPurifyInstance | null = null;
function getPurifier(): DOMPurifyInstance {
  if (purifier) return purifier;
  const win =
    (globalThis as { window?: WindowLike }).window ?? (globalThis as unknown as WindowLike);
  purifier = createDOMPurify(win);
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
  const headings: HeadingEntry[] = [];
  const usedSlugs = new Map<string, number>();

  const marked = new Marked({ gfm: true, breaks: false });

  // Wrap each block-level renderer so it stamps an id and (for headings) a slug.
  const overrides: Record<string, (token: unknown) => string> = {};
  for (const name of BLOCK_METHODS) {
    overrides[name] = function (this: { parser: unknown }, token: unknown) {
      const blockId = `b${counter++}`;
      // Defer to the default renderer for the actual markup. `name` is always a
      // real block method, so the lookup is non-null.
      const renderers = DefaultRenderer as unknown as {
        [k: string]: (this: { parser: unknown }, t: unknown) => string;
      };
      const base = renderers[name] as (this: { parser: unknown }, t: unknown) => string;
      let out: string = base.call(this, token);

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
