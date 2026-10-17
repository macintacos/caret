import "@ui/support/setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import {
  buildFileRefLayer,
  type FileRefSpanMap,
  mergeFileRefSpans,
} from "$lib/diffview/fileRefs.ts";
import { buildLinkLayer } from "$lib/diffview/links.ts";
import { renderPlanMarkdown } from "$lib/planMarkdown.ts";
import { createPlanSourceMap } from "$lib/planSourceMap.ts";
import { type PreviewFileRef, previewFileRefs, tagPreviewFileRefs } from "$lib/previewRefs.ts";

let mounted: HTMLElement[] = [];

afterEach(() => {
  for (const el of mounted) el.remove();
  mounted = [];
});

function mount(text: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderPlanMarkdown(text).html;
  document.body.append(root);
  mounted.push(root);
  return root;
}

/** The resolved spans the view would hold, every path a file except `directories`. */
function resolved(
  text: string,
  directories: string[] = [],
): { refs: FileRefSpanMap; display: string } {
  const layer = buildLinkLayer(text);
  const refs: FileRefSpanMap = new Map();
  for (const [line, spans] of mergeFileRefSpans(buildFileRefLayer(layer.text), layer.fileRefs)) {
    refs.set(
      line,
      spans.map((s) => ({ ...s, kind: directories.includes(s.path) ? "directory" : "file" })),
    );
  }
  return { refs, display: layer.text };
}

function prepare(
  text: string,
  directories: string[] = [],
): { root: HTMLElement; refs: PreviewFileRef[] } {
  const { refs, display } = resolved(text, directories);
  return { root: mount(text), refs: previewFileRefs(refs, display) };
}

function wrappers(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-file-ref]")];
}

const TWIN = "see a.ts and `a.ts`";

const SHAPES = [
  "Cites `src/cache.ts:42` here.", // 1
  "", // 2
  "Also (src/lib/util.ts) inline.", // 3
  "", // 4
  "Read [the cache](src/cache.ts) now.", // 5
  "", // 6
  "The folder `src/lib` holds it.", // 7
  "", // 8
  "- item `src/cache.ts`", // 9
  "", // 10
  "| file |", // 11
  "| --- |", // 12
  "| `src/lib/util.ts` |", // 13
].join("\n");

describe("previewFileRefs", () => {
  test("keys each span by its display text and the earlier occurrences on its line", () => {
    const { refs, display } = resolved(TWIN);
    const keyed = previewFileRefs(refs, display);
    expect(keyed.map(({ line, text, nth }) => ({ line, text, nth }))).toEqual([
      { line: 1, text: "a.ts", nth: 1 },
    ]);
  });
});

describe("tagPreviewFileRefs", () => {
  test("wraps each reference shape's text, in document order, with its kind's tag", () => {
    const { root, refs } = prepare(SHAPES, ["src/lib"]);
    tagPreviewFileRefs(root, refs);
    expect(wrappers(root).map((el) => [el.textContent, el.getAttribute("data-file-ref")])).toEqual([
      ["src/cache.ts:42", ""],
      ["src/lib/util.ts", ""],
      ["the cache", ""],
      ["src/lib", "directory"],
      ["src/cache.ts", ""],
      ["src/lib/util.ts", ""],
    ]);
  });

  test("leaves a path the daemon did not resolve plain", () => {
    const { refs, display } = resolved(SHAPES);
    refs.delete(7);
    const root = mount(SHAPES);
    tagPreviewFileRefs(root, previewFileRefs(refs, display));
    expect(wrappers(root).map((el) => el.textContent)).not.toContain("src/lib");
  });

  test("tags the backticked twin, not the earlier prose occurrence", () => {
    const { root, refs } = prepare(TWIN);
    tagPreviewFileRefs(root, refs);
    const [el] = wrappers(root);
    expect(wrappers(root).length).toBe(1);
    expect(el?.parentElement?.tagName).toBe("CODE");
  });

  test("maps each wrapper to its reference's span", () => {
    const { root, refs } = prepare(SHAPES, ["src/lib"]);
    const tagged = tagPreviewFileRefs(root, refs);
    const spans = wrappers(root).map((el) => tagged.get(el));
    expect(spans[0]).toMatchObject({ path: "src/cache.ts", line: 42 });
    expect(spans[2]).toMatchObject({ path: "src/cache.ts", target: "src/cache.ts" });
    expect(spans[3]).toMatchObject({ path: "src/lib", kind: "directory" });
  });

  test("keeps the text and the source map intact", () => {
    const { root, refs } = prepare(SHAPES, ["src/lib"]);
    const before = root.textContent;
    const early = createPlanSourceMap(root);
    tagPreviewFileRefs(root, refs);
    const late = createPlanSourceMap(root);
    expect(root.textContent).toBe(before);
    const lines = wrappers(root).map((el) => {
      const node = el.firstChild as Text;
      return [early.lineAt(node, 1), late.lineAt(node, 1)];
    });
    expect(lines).toEqual([
      [1, 1],
      [3, 3],
      [5, 5],
      [7, 7],
      [9, 9],
      [13, 13],
    ]);
  });

  test("a re-run replaces the previous wrappers rather than nesting them", () => {
    const { root, refs } = prepare(SHAPES, ["src/lib"]);
    tagPreviewFileRefs(root, refs);
    tagPreviewFileRefs(root, refs);
    expect(wrappers(root).length).toBe(6);
    expect(root.querySelector("[data-file-ref] [data-file-ref]") === null).toBe(true);
    tagPreviewFileRefs(root, []);
    expect(wrappers(root).length).toBe(0);
  });

  test("leaves a reference plain when its text is not rendered as one run", () => {
    const text = "[**bold** label](src/cache.ts)";
    const { root, refs } = prepare(text);
    const missing: PreviewFileRef = { ...refs[0]!, text: "nowhere.ts" };
    expect(() => tagPreviewFileRefs(root, [...refs, missing])).not.toThrow();
    expect(wrappers(root).length).toBe(0);
  });

  test("tags nothing for an empty link label", () => {
    const { root, refs } = prepare("See [](src/a.ts) here.");
    tagPreviewFileRefs(root, refs);
    expect(wrappers(root).length).toBe(0);
  });

  test("leaves a reference plain when an escape elsewhere on its line hides an occurrence", () => {
    const { root, refs } = prepare("Edit my\\_file.py then `my_file.py`.");
    tagPreviewFileRefs(root, refs);
    expect(wrappers(root).some((el) => el.parentElement?.tagName === "P")).toBe(false);
  });

  test("tags only the unambiguous reference when an escape shifts occurrences into another match", () => {
    const { root, refs } = prepare("Edit my\\_file.py (src/my_file.py) and `my_file.py`.");
    expect(() => tagPreviewFileRefs(root, refs)).not.toThrow();
    expect(wrappers(root).map((el) => el.textContent)).toEqual(["src/my_file.py"]);
  });

  test("tags every reference in a long plan", () => {
    const sections = Array.from({ length: 40 }, (_, i) =>
      [
        `## S${i}`,
        "",
        `See \`src/f${i}.ts\` and (src/g${i}.ts).`,
        "",
        "```ts",
        "const x = 1;",
        "```",
      ].join("\n"),
    );
    const { root, refs } = prepare(sections.join("\n\n"));
    tagPreviewFileRefs(root, refs);
    expect(wrappers(root).map((el) => el.textContent)).toEqual(
      sections.flatMap((_, i) => [`src/f${i}.ts`, `src/g${i}.ts`]),
    );
  });
});
