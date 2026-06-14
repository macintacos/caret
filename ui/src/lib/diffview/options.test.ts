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

  test("spreads link handlers into the library options when provided", () => {
    const onTokenClick = () => {};
    const onTokenEnter = () => {};
    const onTokenLeave = () => {};
    const result = toFileOptions(
      { overflow: "wrap" },
      { onTokenClick, onTokenEnter, onTokenLeave },
    );
    expect(result.onTokenClick).toBe(onTokenClick);
    expect(result.onTokenEnter).toBe(onTokenEnter);
    expect(result.onTokenLeave).toBe(onTokenLeave);
    expect(result.overflow).toBe("wrap");
  });

  test("enables the token transformer when link handlers are present", () => {
    // The library only emits per-token data-char markers (which the click/hover
    // hit-test needs) when useTokenTransformer is explicitly set, so the option
    // must accompany the handlers.
    const result = toFileOptions(
      {},
      { onTokenClick: () => {}, onTokenEnter: () => {}, onTokenLeave: () => {} },
    );
    expect(result.useTokenTransformer).toBe(true);
  });

  test("omitting link handlers leaves the option object handler-free", () => {
    const result = toFileOptions({ overflow: "wrap" });
    expect("onTokenClick" in result).toBe(false);
    expect("useTokenTransformer" in result).toBe(false);
  });

  test("spreads the gutter utility opt-in and callbacks when provided", () => {
    const onGutterUtilityClick = () => {};
    const renderAnnotation = () => document.createElement("div");
    const result = toFileOptions({}, undefined, {
      enableGutterUtility: true,
      enableLineSelection: true,
      onGutterUtilityClick,
      renderAnnotation,
    });
    expect(result.enableGutterUtility).toBe(true);
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
  test("maps the diff options including the layout style", () => {
    expect(toFileDiffOptions({ diffStyle: "split", overflow: "scroll" })).toEqual({
      overflow: "scroll",
      disableLineNumbers: undefined,
      theme: caretTheme,
      themeType: "system",
      diffStyle: "split",
    });
  });

  test("leaves unset options undefined so library defaults apply, theme always set", () => {
    expect(toFileDiffOptions({})).toEqual({
      overflow: undefined,
      disableLineNumbers: undefined,
      theme: caretTheme,
      themeType: "system",
      diffStyle: undefined,
    });
  });
});
