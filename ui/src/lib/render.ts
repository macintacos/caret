// Markdown -> sanitized HTML with structural block ids.
//
// Each block-level element gets a deterministic token-index id `id="b{n}"`
// (n increments in document order). Heading slugs live on `data-slug` so the
// single `id` slot stays reserved for the structural anchor that annotations
// reference. Annotation char offsets are measured against the block element's
// post-sanitize `textContent`, so the ids must survive sanitization.
//
// Sanitize-last is a structural guarantee, not a comment: `sanitize()` is the
// sole producer of the branded `SanitizedHtml`, and `RenderResult.html` requires
// that brand. Any string operation on a SanitizedHtml (`.replace`, concatenation,
// …) yields a plain `string` that is not assignable back to the branded field,
// so a future edit that mutates the HTML after sanitize is a compile error.

import createDOMPurify from "dompurify";
import type { DOMPurify as DOMPurifyInstance, WindowLike } from "dompurify";
import { Marked, Renderer } from "marked";
import { highlightToHtml } from "./highlight.ts";
import { uiLog } from "./log.ts";

// Matches a `style` value that contains ONLY shiki's dual-theme output: the
// `--shiki-*` custom properties (per-token `--shiki-light`/`--shiki-dark` colors,
// `--shiki-*-bg` on the <pre>, and `--shiki-*-font-style`/`-font-weight` for
// italic/bold tokens), or color / background-color derived from them. Values are
// limited to inert hex / rgb / var(--shiki…) / font keywords / weight numbers.
// Anything else (`position`, `z-index`, `url(...)`, …) fails the match and the
// whole attribute is dropped — so this narrows, never widens, the XSS surface.
const SHIKI_STYLE =
	/^(?:(?:--shiki[\w-]*|color|background-color)\s*:\s*(?:#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s%]+\)|var\(--shiki[\w-]*\)|italic|oblique|normal|bold|bolder|lighter|\d{1,3})\s*;?\s*)+$/;

/**
 * Whether a `style` attribute value is exclusively shiki's dual-theme token
 * output (the SHIKI_STYLE shape). This is the security boundary for inline
 * styles: the sanitizer keeps a `style` attribute only when this returns true,
 * and drops it otherwise. Exported as the unit-testable surface for that gate
 * (EXC-535); the sanitize hook is its sole production caller, so there is one
 * source of truth. The value is trimmed before matching, as the hook requires.
 */
export function isShikiStyle(value: string): boolean {
	return SHIKI_STYLE.test(value.trim());
}

// The exact set of tags the render pipeline emits, enumerated so the sanitizer
// admits only this known-good allowlist rather than stripping a known-bad set —
// the stronger posture given plan markdown is attacker-influenced. Three sources:
//   - marked block elements (gfm): headings, paragraph, lists, code, blockquote,
//     the table family, hr.
//   - marked inline elements (gfm): links, emphasis, strikethrough, hard breaks,
//     images.
//   - shiki's dual-theme tree: <pre>/<code> wrap a <span> token tree.
// A tag marked never emits (form, iframe, svg, object, …) is absent, so it is
// dropped wholesale. Keep this in lockstep with what the golden fixture and the
// render/highlight suites exercise — a missing tag breaks rendering AND the
// annotation id-coverage that anchors against block elements.
const ALLOWED_TAGS = [
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"p",
	"blockquote",
	"ul",
	"ol",
	"li",
	"pre",
	"code",
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
	"hr",
	"a",
	"em",
	"strong",
	"del",
	"br",
	"img",
	"span",
] as const;

// The attributes the pipeline emits. `id`/`data-slug` are the structural anchors
// stamped before sanitize; `href`/`src`/`alt`/`align` are marked's link, image,
// and table-alignment attributes; `class`/`style`/`tabindex` ride shiki's <pre>
// and token spans (`class="language-*"` also on marked's plain code fallback).
// `style` is admitted by name but every value is still gated through the
// uponSanitizeAttribute shiki-style hook below, so only shiki-shaped styles pass.
// DOMPurify drops dangerous URI schemes (javascript:, data:html) from href/src
// regardless of this list, so allowing the attribute name does not allow the
// scheme.
const ALLOWED_ATTR = [
	"id",
	"data-slug",
	"href",
	"src",
	"alt",
	"align",
	"class",
	"style",
	"tabindex",
] as const;

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
			if (isShikiStyle(data.attrValue)) data.forceKeepAttr = true;
			else data.keepAttr = false;
		}
	});
	return purifier;
}

/**
 * The terminal sanitize step and the SOLE producer of `SanitizedHtml`. Runs the
 * id-stamped raw HTML through DOMPurify with the explicit ALLOWED_TAGS/
 * ALLOWED_ATTR allowlist (a tag or attribute the pipeline never emits is
 * dropped), keeping `id`/`data-slug` as the structural anchors. The brand cast
 * is the one place it is applied, so any caller that mutates the result loses
 * the brand and cannot satisfy `RenderResult.html` — this is what makes
 * sanitize-last structural.
 */
function sanitize(rawHtml: string): SanitizedHtml {
	return getPurifier().sanitize(rawHtml, {
		ALLOWED_TAGS: ALLOWED_TAGS as unknown as string[],
		ALLOWED_ATTR: ALLOWED_ATTR as unknown as string[],
	}) as SanitizedHtml;
}

export interface HeadingEntry {
	level: number;
	slug: string;
	text: string;
	/** Structural id of the heading's block element, e.g. "b3". */
	blockId: string;
}

/**
 * Whether the contents rail should render. Suppressed for plans with no
 * headings (nothing to navigate) and for a single heading (a one-tick rail is
 * noise, not navigation); a rail earns its place from two headings up.
 */
export function shouldShowRail(headings: HeadingEntry[]): boolean {
	return headings.length >= 2;
}

/**
 * HTML that has passed through the terminal DOMPurify `sanitize()` and nothing
 * since. The brand is unforgeable outside `sanitize()`, so a value of this type
 * is a proof that sanitize ran last on it. Mutating it (`.replace`, concat, …)
 * produces a plain `string`, breaking the brand — which is why such a mutation
 * can never satisfy `RenderResult.html` and the sanitize-last invariant holds
 * structurally rather than by comment.
 */
export type SanitizedHtml = string & { readonly __sanitized: unique symbol };

export interface RenderResult {
	html: SanitizedHtml;
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

// A bare Marked renderer instance whose default block methods we delegate to.
// (Created once; stateless across renders.)
const DefaultRenderer = new Renderer();

// The override wiring below is structurally coupled to two marked internals
// that an upgrade could silently break: each BLOCK_METHODS name must still be a
// method on the renderer (to delegate to), and that method's output must still
// start with the block's opening tag (so injectAttrs can stamp the structural
// id onto it). The casts that bridge those couplings carry no compile-time
// signal, so we assert both at runtime and throw loudly on drift rather than
// emit ids-less HTML that breaks annotation anchoring.
type RendererBlockMethod = (this: { parser: unknown }, token: unknown) => string;

/**
 * The default renderer's method for `name`, or a loud throw if marked dropped
 * it. Exported for direct unit testing of the renderer-drift guard.
 */
export function baseBlockMethod(name: (typeof BLOCK_METHODS)[number]): RendererBlockMethod {
	const method = (DefaultRenderer as unknown as Record<string, unknown>)[name];
	if (typeof method !== "function") {
		throw new Error(`render: marked Renderer has no block method "${name}" (renderer drift)`);
	}
	return method as RendererBlockMethod;
}

function slugify(text: string): string {
	return text
		.toLowerCase()
		.trim()
		.replace(/[^\w\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

/** Matches the leading opening tag that injectAttrs stamps the structural id onto. */
const OPENING_TAG = /^(\s*<[a-zA-Z][\w-]*)/;

/**
 * Inserts `attrs` into the first opening tag of `html`. A block renderer's
 * output must start with that tag; if it doesn't (renderer drift), a silent
 * no-op `replace` would emit a block with no structural id and break annotation
 * anchoring, so throw loudly instead. Exported for direct unit testing of the
 * renderer-drift guard.
 */
export function injectAttrs(html: string, attrs: string): string {
	if (!OPENING_TAG.test(html)) {
		throw new Error(
			`render: block HTML does not start with an opening tag, cannot stamp "${attrs}" (renderer drift)`,
		);
	}
	return html.replace(OPENING_TAG, `$1 ${attrs}`);
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

			// Defer to the default renderer for the actual markup; baseBlockMethod
			// throws loudly if marked dropped or renamed this block method.
			const base = baseBlockMethod(name);

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

	// All id/data-slug stamping happens in the renderer overrides ABOVE; sanitize()
	// is the terminal step and the only producer of the `SanitizedHtml` brand that
	// `html` (and RenderResult.html) carries. Mutating `html` after this point
	// yields a plain `string` that no longer satisfies the brand, so the type
	// system — not this comment — enforces that nothing runs after sanitize.
	let html: SanitizedHtml;
	try {
		const rawHtml = marked.parse(markdown, { async: false }) as string;
		html = sanitize(rawHtml);
	} catch (err) {
		// Surface a render failure on the timeline, then rethrow unchanged so the
		// caller still sees the same throw. Counts only — never the plan text.
		uiLog.error("render", err, { chars: markdown.length });
		throw err;
	}

	// App.svelte memoizes renderPlan per review id:version, so this is one record
	// per plan version — not per poll tick.
	uiLog.debug("render", "plan rendered", {
		chars: markdown.length,
		blocks: counter,
		headings: headings.length,
	});

	return { html, headings };
}
