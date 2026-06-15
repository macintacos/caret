import { describe, expect, test } from "bun:test";
import { toFileDiffOptions, toFileOptions } from "./options.ts";

// The option mapping always emits a complete library option object from the
// current caret options, so passing its output to setOptions is a faithful
// full replacement (the library swaps options wholesale, never merges). Every
// emitted object also carries caret's fixed Shiki theme selection so the diff
// view highlights consistently regardless of which caret options are set.

const caretTheme = { light: "caret-light", dark: "caret-dark" };

describe("toFileOptions", () => {
  test("maps the caret single-document options through", () => {
    expect(toFileOptions({ overflow: "wrap", disableLineNumbers: true })).toEqual({
      overflow: "wrap",
      disableLineNumbers: true,
      theme: caretTheme,
      themeType: "system",
    });
  });

  test("leaves unset options undefined so library defaults apply, theme always set", () => {
    expect(toFileOptions({})).toEqual({
      overflow: undefined,
      disableLineNumbers: undefined,
      theme: caretTheme,
      themeType: "system",
    });
  });

  test("spreads the composed token handlers into the library options when provided", () => {
    const onTokenClick = () => {};
    const onTokenEnter = () => {};
    const onTokenLeave = () => {};
    const result = toFileOptions(
      { overflow: "wrap" },
      {
        handlers: { onTokenClick, onTokenEnter, onTokenLeave },
        libOptions: { useTokenTransformer: true },
        wasLinkClick: () => false,
      },
    );
    expect(result.onTokenClick).toBe(onTokenClick);
    expect(result.onTokenEnter).toBe(onTokenEnter);
    expect(result.onTokenLeave).toBe(onTokenLeave);
    expect(result.overflow).toBe("wrap");
  });

  test("carries the composed token transformer flag through", () => {
    // The library only emits per-token data-char markers (which the click/hover
    // hit-test needs) when useTokenTransformer is explicitly set. composeTokenHandlers
    // owns that flag and ships it in libOptions; toFileOptions only relays it, so the
    // flag can never drift apart from the handlers it accompanies.
    const result = toFileOptions(
      {},
      {
        handlers: { onTokenClick: () => {}, onTokenEnter: () => {}, onTokenLeave: () => {} },
        libOptions: { useTokenTransformer: true },
        wasLinkClick: () => false,
      },
    );
    expect(result.useTokenTransformer).toBe(true);
  });

  test("omitting the composed token bag leaves the option object handler-free", () => {
    const result = toFileOptions({ overflow: "wrap" });
    expect("onTokenClick" in result).toBe(false);
    expect("useTokenTransformer" in result).toBe(false);
  });

  test("spreads the gutter utility opt-in and callbacks when provided", () => {
    const onGutterUtilityClick = () => {};
    const renderAnnotation = () => document.createElement("div");
    const result = toFileOptions({}, undefined, {
      enableGutterUtility: true,
      lineHoverHighlight: "both",
      enableLineSelection: true,
      onGutterUtilityClick,
      renderAnnotation,
    });
    expect(result.enableGutterUtility).toBe(true);
    // The hover highlight rides through the gutter bag so the library lights the
    // hovered line (its --diffs-bg-hover-override lift) — without it the whole-line
    // comment target reads only at the gutter edge.
    expect(result.lineHoverHighlight).toBe("both");
    expect(result.enableLineSelection).toBe(true);
    expect(result.onGutterUtilityClick).toBe(onGutterUtilityClick);
    expect(result.renderAnnotation).toBe(renderAnnotation);
  });

  test("spreads the live line-selection callbacks when provided", () => {
    // The library fires these during a drag; bridging them through the gutter bag
    // is what feeds the host's live "Lines X–Y" readout before release.
    const onLineSelectionStart = () => {};
    const onLineSelectionChange = () => {};
    const onLineSelectionEnd = () => {};
    const result = toFileOptions({}, undefined, {
      enableGutterUtility: true,
      lineHoverHighlight: "both",
      enableLineSelection: true,
      onGutterUtilityClick: () => {},
      renderAnnotation: () => undefined,
      onLineSelectionStart,
      onLineSelectionChange,
      onLineSelectionEnd,
    });
    expect(result.onLineSelectionStart).toBe(onLineSelectionStart);
    expect(result.onLineSelectionChange).toBe(onLineSelectionChange);
    expect(result.onLineSelectionEnd).toBe(onLineSelectionEnd);
  });

  test("omitting the gutter bag leaves the option object gutter-free", () => {
    const result = toFileOptions({ overflow: "wrap" });
    expect("enableGutterUtility" in result).toBe(false);
    expect("onGutterUtilityClick" in result).toBe(false);
    expect("renderAnnotation" in result).toBe(false);
  });

  test("spreads the line-click handler when provided", () => {
    const onLineClick = () => {};
    const result = toFileOptions({}, undefined, undefined, onLineClick);
    expect(result.onLineClick).toBe(onLineClick);
  });

  test("omitting the line-click handler leaves the option object click-free", () => {
    const result = toFileOptions({ overflow: "wrap" });
    expect("onLineClick" in result).toBe(false);
  });
});

describe("toFileDiffOptions", () => {
  test("maps the diff options including the layout style and indicators", () => {
    expect(
      toFileDiffOptions({ diffStyle: "split", overflow: "scroll", diffIndicators: "classic" }),
    ).toEqual({
      overflow: "scroll",
      disableLineNumbers: undefined,
      theme: caretTheme,
      themeType: "system",
      diffStyle: "split",
      diffIndicators: "classic",
      hunkSeparators: "line-info",
      expandUnchanged: false,
      stickyHeader: true,
    });
  });

  test("leaves unset options undefined so library defaults apply, theme always set", () => {
    expect(toFileDiffOptions({})).toEqual({
      overflow: undefined,
      disableLineNumbers: undefined,
      theme: caretTheme,
      themeType: "system",
      diffStyle: undefined,
      diffIndicators: undefined,
      hunkSeparators: "line-info",
      expandUnchanged: false,
      stickyHeader: true,
    });
  });

  test("pins hunkSeparators and expandUnchanged so a library default flip can't drift them", () => {
    // The collapsed-context band IS the line-info separator: caret themes its
    // surface through the FND --diffs-bg-separator-override bridge in app.css, so
    // the mapper pins the separator kind rather than inheriting it. expandUnchanged
    // stays false so context keeps collapsing — the band and its expand pills only
    // exist while context is hidden. Both currently equal the library defaults;
    // emitting them explicitly keeps the rethemed surface stable across a bump.
    const result = toFileDiffOptions({});
    expect(result.hunkSeparators).toBe("line-info");
    expect(result.expandUnchanged).toBe(false);
  });

  test("pins the compare header sticky so the version pair and counts stay in view", () => {
    // The library scrolls its default header away on a long diff; sticky keeps the
    // version-pair name and the +N/-N counts pinned to the top of the viewport. The
    // pinned header fills over code on caret's --paper-sunk (the [data-sticky] rule
    // reads --diffs-bg, which the .diffview bridge maps).
    expect(toFileDiffOptions({}).stickyHeader).toBe(true);
  });
});
