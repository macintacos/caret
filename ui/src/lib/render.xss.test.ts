// Adversarial coverage for the plan-render pipeline (EXC-535). Three concerns:
//   1. isShikiStyle — fuzz the inline-style gate: reject hostile declarations,
//      whitespace/comment evasions, var() escapes, and a shiki-shaped prefix
//      followed by a trailing dangerous decl; accept genuine shiki vocabulary.
//   2. renderPlan — assert DOMPurify is bound and strips a broad battery of XSS
//      vectors so the output HTML is inert.
//   3. shiki ↔ SHIKI_STYLE coupling — feed REAL shiki output through isShikiStyle
//      and assert every emitted inline style passes, the way caret-theme.test.ts
//      guards the palette: a future shiki output-shape change fails this unit.
//
// All payloads are synthetic and non-identifying.

import "../../test-setup.ts";
import { beforeAll, describe, expect, test } from "bun:test";
import { highlightToHtml, initHighlighter } from "./highlight.ts";
import { isShikiStyle, renderPlan } from "./render.ts";

describe("isShikiStyle rejects hostile inline styles", () => {
  // Each value is a style attribute an attacker might smuggle in; none is
  // exclusively shiki's token output, so all must fail the gate.
  const HOSTILE: { name: string; value: string }[] = [
    { name: "position:fixed", value: "position:fixed" },
    { name: "inset overlay", value: "position:fixed;inset:0;z-index:9999" },
    { name: "z-index", value: "z-index:9999" },
    { name: "background url()", value: "background:url(http://evil.example/x)" },
    {
      name: "background-image javascript: url()",
      value: "background-image:url(javascript:alert(1))",
    },
    { name: "IE expression()", value: "width:expression(alert(1))" },
    { name: "IE behavior url()", value: "behavior:url(#default#time2)" },
    { name: "-moz-binding url()", value: "-moz-binding:url(http://evil.example/x.xml#x)" },
    { name: "opacity (non-shiki prop)", value: "opacity:0" },
    { name: "display:none", value: "display:none" },
    // A genuine-looking shiki prefix followed by a trailing dangerous decl:
    // the gate must reject the whole value, not stop at the first good decl.
    {
      name: "shiki prefix + trailing url()",
      value: "--shiki-light:#211c18;background:url(javascript:alert(1))",
    },
    {
      name: "shiki prefix + trailing position",
      value: "color:#211c18;position:fixed",
    },
    // var() with an embedded escape / non-shiki name — only var(--shiki…) is
    // allowed, so a var() pointing elsewhere (or with escapes) must fail.
    { name: "var() non-shiki name", value: "color:var(--evil)" },
    { name: "var() with css escape", value: "color:var(--shiki\\29 light)" },
    { name: "var() with url fallback", value: "color:var(--x, url(javascript:alert(1)))" },
  ];

  test.each(HOSTILE)("rejects $name", ({ value }) => {
    expect(isShikiStyle(value)).toBe(false);
  });

  // Whitespace / comment-CSS evasions against the regex's `\s*` flexibility.
  // `\s` does not match a CSS `/* */` comment, an actual newline embedded in a
  // declaration value, or a NUL, so each of these must still be rejected.
  const EVASIONS: { name: string; value: string }[] = [
    { name: "CSS comment splice", value: "color:#211c18;/* */position:fixed" },
    { name: "comment inside decl", value: "color:/* */url(javascript:alert(1))" },
    { name: "newline before dangerous decl", value: "color:#211c18;\nposition:fixed" },
    { name: "tab before dangerous decl", value: "color:#211c18;\tbackground:url(x)" },
    { name: "newline inside url()", value: "background:url(java\nscript:alert(1))" },
    { name: "NUL byte splice", value: "color:#211c18;\u0000position:fixed" },
    { name: "leading junk", value: "evil;--shiki-light:#211c18" },
  ];

  test.each(EVASIONS)("rejects $name", ({ value }) => {
    expect(isShikiStyle(value)).toBe(false);
  });

  test("rejects the empty string and bare whitespace", () => {
    expect(isShikiStyle("")).toBe(false);
    expect(isShikiStyle("   \n\t ")).toBe(false);
  });
});

describe("isShikiStyle accepts genuine shiki vocabulary", () => {
  // The shapes shiki emits with defaultColor:false and the caret themes: dual
  // --shiki-light/--shiki-dark color vars, color/background-color, the font-style
  // and font-weight token vars, and the inert value vocabulary (hex / rgb /
  // var(--shiki…) / font keywords / weight numbers).
  const VALID: { name: string; value: string }[] = [
    { name: "dual color vars", value: "--shiki-light:#211c18;--shiki-dark:#ece4d6" },
    {
      name: "trailing semicolon + spaces",
      value: "--shiki-light: #211c18; --shiki-dark: #ece4d6;",
    },
    { name: "8-digit hex (alpha)", value: "--shiki-light:#211c18ff" },
    { name: "3-digit hex", value: "color:#abc" },
    { name: "rgb()", value: "color:rgb(33, 28, 24)" },
    { name: "rgba()", value: "background-color:rgba(33, 28, 24, 0.5)" },
    { name: "var(--shiki…) reference", value: "color:var(--shiki-light)" },
    { name: "font-style var italic", value: "--shiki-light-font-style:italic" },
    { name: "font-weight var bold", value: "--shiki-light-font-weight:bold" },
    { name: "weight number", value: "--shiki-light-font-weight:700" },
    {
      name: "color + font-style combo",
      value: "--shiki-light:#9a9082;--shiki-light-font-style:italic",
    },
    { name: "bg var on <pre>", value: "--shiki-light-bg:#efe8d8;--shiki-dark-bg:#110e0a" },
  ];

  test.each(VALID)("accepts $name", ({ value }) => {
    expect(isShikiStyle(value)).toBe(true);
  });
});

describe("renderPlan strips XSS vectors (DOMPurify is bound)", () => {
  // Each vector is fed as raw HTML embedded in plan markdown; the rendered
  // output must not contain the dangerous bit. These are the things only the
  // terminal DOMPurify sanitize neutralizes.
  const VECTORS: { name: string; markdown: string; absent: string[] }[] = [
    {
      name: "javascript: in <a href>",
      markdown: '<a href="javascript:alert(1)">x</a>\n',
      absent: ["javascript:"],
    },
    {
      name: "data: HTML in <a href>",
      markdown: '<a href="data:text/html,<script>alert(1)</script>">x</a>\n',
      absent: ["data:text/html", "<script"],
    },
    {
      name: "javascript: in <img src>",
      markdown: '<img src="javascript:alert(1)">\n',
      absent: ["javascript:"],
    },
    {
      name: "<img onerror>",
      markdown: '<img src="x" onerror="alert(1)">\n',
      absent: ["onerror", "alert(1)"],
    },
    {
      // srcdoc content executes in a real browser; the whole element must go.
      name: "<iframe srcdoc>",
      markdown: '<iframe srcdoc="<script>alert(1)</script>">x</iframe>\n',
      absent: ["<iframe", "<script", "alert(1)"],
    },
    {
      name: "<object>",
      markdown: "<object>fallback</object>\n",
      absent: ["<object"],
    },
    {
      name: "<embed>",
      markdown: "<embed>\n",
      absent: ["<embed"],
    },
    {
      name: "SVG <use href>",
      markdown: '<svg><use href="https://evil.example/x.svg#y"></use></svg>\n',
      absent: ["<use", "evil.example"],
    },
    {
      name: "inline <svg onload>",
      markdown: '<svg onload="alert(1)"></svg>\n',
      absent: ["onload", "alert(1)"],
    },
    {
      name: "<details ontoggle>",
      markdown: '<details ontoggle="alert(1)"><summary>x</summary>y</details>\n',
      absent: ["ontoggle", "alert(1)"],
    },
    {
      // DOMPurify keeps <form> under the html profile but strips a
      // javascript: action — assert the dangerous URL is gone, the channel
      // that would actually execute.
      name: "<form javascript: action>",
      markdown: '<form action="javascript:alert(1)"><button>go</button></form>\n',
      absent: ["javascript:", "alert(1)"],
    },
    {
      name: "<button formaction javascript:>",
      markdown: '<button formaction="javascript:alert(1)">go</button>\n',
      absent: ["formaction", "javascript:", "alert(1)"],
    },
    {
      name: "CSS-context style payload",
      markdown: '<p style="background:url(javascript:alert(1))">x</p>\n',
      absent: ["javascript:", "background:url"],
    },
  ];

  test.each(VECTORS)("neutralizes $name", ({ markdown, absent }) => {
    const { html } = renderPlan(markdown);
    for (const needle of absent) {
      expect(html).not.toContain(needle);
    }
  });

  // A regression that no-op'd getPurifier (returning raw marked output) would
  // leave this <iframe> intact: marked passes inline HTML through verbatim and
  // does no attribute/tag stripping, so only the bound DOMPurify removes it.
  // This is the canary that the purifier is actually invoked.
  test("DOMPurify is invoked: a marked-passthrough <iframe> is removed", () => {
    const { html } = renderPlan('text\n\n<iframe srcdoc="<script>alert(1)</script>">x</iframe>\n');
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<script");
  });
});

// EXC-536: the sanitizer is an explicit known-good allowlist (ALLOWED_TAGS /
// ALLOWED_ATTR), not the profile-permissive USE_PROFILES:{html:true}. These
// elements ARE valid HTML the `html` profile admitted, so the old config left
// them in the output; the allowlist enumerates only what the marked + shiki
// pipeline emits, so each of these tags — none of which the pipeline produces —
// is now dropped. That is the strictly-safer narrowing the allowlist buys.
describe("explicit allowlist drops tags the html profile admitted", () => {
  const NOW_STRIPPED: { name: string; markdown: string; absentTag: string }[] = [
    { name: "<form>", markdown: '<form action="/x"><span>go</span></form>\n', absentTag: "<form" },
    {
      name: "<button>",
      markdown: '<button type="submit">go</button>\n',
      absentTag: "<button",
    },
    { name: "<input>", markdown: '<input name="q" value="x">\n', absentTag: "<input" },
    { name: "<textarea>", markdown: "<textarea>typed</textarea>\n", absentTag: "<textarea" },
    { name: "<select>", markdown: "<select><option>a</option></select>\n", absentTag: "<select" },
    { name: "<label>", markdown: "<label>field</label>\n", absentTag: "<label" },
    { name: "<fieldset>", markdown: "<fieldset>x</fieldset>\n", absentTag: "<fieldset" },
    {
      name: "<details>",
      markdown: "<details><summary>s</summary>body</details>\n",
      absentTag: "<details",
    },
    { name: "<dialog>", markdown: "<dialog open>x</dialog>\n", absentTag: "<dialog" },
    { name: "<audio>", markdown: "<audio controls></audio>\n", absentTag: "<audio" },
    { name: "<video>", markdown: "<video></video>\n", absentTag: "<video" },
    { name: "<div>", markdown: '<div class="wrap">x</div>\n', absentTag: "<div" },
    { name: "<style>", markdown: "<style>p{color:red}</style>\n", absentTag: "<style" },
    // <h1>..<h6> remain allowed (the pipeline emits them); <section> is a
    // structural wrapper the pipeline never emits, so it is dropped.
    { name: "<section>", markdown: "<section><p>x</p></section>\n", absentTag: "<section" },
  ];

  test.each(NOW_STRIPPED)("drops $name (admitted by the old html profile)", ({
    markdown,
    absentTag,
  }) => {
    const { html } = renderPlan(markdown);
    expect(html).not.toContain(absentTag);
  });

  // A non-shiki inline `style` an attacker might smuggle on an allowed element:
  // the allowlist names `style` but the uponSanitizeAttribute gate still drops
  // every value that is not shiki-shaped, so a benign-looking color: declaration
  // on a <p> is removed (no style survives on a non-shiki element).
  test("drops a non-shiki style on an allowed element", () => {
    const { html } = renderPlan('<p style="color:red">styled</p>\n');
    expect(html).toContain("<p");
    expect(html).not.toContain("style=");
    expect(html).not.toContain("color:red");
  });

  // Markdown links emit only `href` (no target/rel), so valid links are
  // unchanged; a raw-HTML link's target/rel are not in ALLOWED_ATTR and drop —
  // the link element and its href stay, the navigation-context attrs go.
  test("keeps a link's href but drops target/rel not in the allowlist", () => {
    const { html } = renderPlan(
      '<a href="https://ok.test" target="_blank" rel="noreferrer">x</a>\n',
    );
    expect(html).toContain('href="https://ok.test"');
    expect(html).not.toContain("target=");
    expect(html).not.toContain("rel=");
  });

  // An attribute the old profile kept on any allowed element (title, a global
  // HTML attribute) is dropped, since ALLOWED_ATTR enumerates only the pipeline's
  // attributes. id survives (structural anchor); title does not.
  test("drops a global HTML attribute the pipeline never emits (title)", () => {
    const { html } = renderPlan('<p title="tip" id="keep">t</p>\n');
    expect(html).toContain('id="keep"');
    expect(html).not.toContain("title=");
  });
});

// EXC-536: the sanitize-last invariant is structural. `RenderResult.html` is a
// branded `SanitizedHtml`, produced only by the terminal sanitize step; a future
// edit that mutated the HTML afterward would yield a plain string that fails the
// brand (a compile error, verified by `bun run tsc`). At runtime these assert the
// observable consequence the brand protects: every structural id/data-slug is
// present in the FINAL sanitized output — i.e. nothing stamped before sanitize
// was stripped by it, and nothing was (or could be) stamped after.
describe("structural ids survive the terminal sanitize", () => {
  const PLAN = "# Title\n\nbody paragraph\n\n## Section\n\n- one\n- two\n";

  test("every block carries its id in the post-sanitize html", () => {
    const { html, headings } = renderPlan(PLAN);
    // Sequential b0..bN ids are present in the sanitized output (sanitize did
    // not strip the structural anchors stamped before it).
    const ids = [...html.matchAll(/id="(b\d+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual(ids.map((_, i) => `b${i}`));
    // Heading data-slugs survive too, on the same elements as the ids.
    for (const h of headings) {
      expect(html).toContain(`id="${h.blockId}"`);
      expect(html).toContain(`data-slug="${h.slug}"`);
    }
  });

  test("a stamped block's id survives sanitize even with a hostile sibling", () => {
    // The first paragraph is plain markdown, so the override stamps it id="b0"
    // BEFORE sanitize; the second block is attacker-injected raw HTML carrying
    // an onclick. The sanitized output keeps the stamped structural id and drops
    // the handler — proof the terminal sanitize ran on the id-stamped HTML, with
    // the id intact afterward.
    const { html } = renderPlan('annotated text\n\n<p onclick="evil()">hostile</p>\n');
    expect(html).toMatch(/<p id="b0">annotated text<\/p>/);
    expect(html).not.toContain("onclick");
  });
});

// Runs last: the highlighter singleton is process-global, so initializing it
// here mirrors the existing highlight/render suites and leaves it ready. Feeds
// REAL shiki output through the gate so a future output-shape change fails here.
describe("shiki ↔ SHIKI_STYLE coupling", () => {
  beforeAll(async () => {
    await initHighlighter();
  });

  // One snippet per loaded grammar, chosen to exercise color, italic comment,
  // and bold (markdown heading) token styles — the full --shiki-* vocabulary.
  const SNIPPETS: { lang: string; code: string }[] = [
    { lang: "typescript", code: "// note\nconst x: number = 1;" },
    { lang: "javascript", code: "const s = 'hi';" },
    { lang: "json", code: '{"x": 1}' },
    { lang: "yaml", code: "x: 1 # comment" },
    { lang: "toml", code: "x = 1 # comment" },
    { lang: "shellscript", code: "# note\necho hi" },
    { lang: "diff", code: "+added\n-removed" },
    { lang: "markdown", code: "# Heading\n\n*em* and **bold**" },
  ];

  test.each(SNIPPETS)("every inline style shiki emits for $lang passes isShikiStyle", ({
    lang,
    code,
  }) => {
    const out = highlightToHtml(code, lang);
    expect(out).not.toBeNull();
    const styles = [...(out as string).matchAll(/style="([^"]*)"/g)].map((m) => m[1]!);
    // shiki always emits at least the per-token color vars, so there must be
    // styles to check — guards against the regex silently matching nothing.
    expect(styles.length).toBeGreaterThan(0);
    for (const value of styles) {
      expect(isShikiStyle(value), `shiki style not accepted: ${value}`).toBe(true);
    }
  });

  // End-to-end: real shiki output survives renderPlan's terminal sanitize, so a
  // drift that made isShikiStyle reject genuine shiki output would strip the
  // token colors here.
  test("real shiki token styles survive renderPlan sanitization", () => {
    const { html } = renderPlan("```ts\n// note\nconst x = 1;\n```\n");
    expect(html).toContain("--shiki-light:");
    expect(html).toContain("--shiki-dark:");
    expect(html).toContain("--shiki-light-font-style:italic");
  });
});
