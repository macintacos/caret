// Maps caret-domain view options to complete @pierre/diffs option objects.
// The library's setOptions replaces its options wholesale (no merging), so
// each mapper emits every key it owns — passing the result to setOptions is
// always a faithful full replacement.
import type {
  FileDiffOptions,
  FileOptions,
  LineAnnotation,
  SelectedLineRange,
} from "@pierre/diffs";
import type { LinkHandlers } from "./linkInteractions.ts";
import { caretDiffTheme } from "./theme.ts";
import type { SourceDiffViewOptions, SourceViewOptions } from "./types.ts";

/** The gutter-utility opt-in plus its callbacks, supplied by a view that lets
 * the reviewer comment on a line. `renderAnnotation` builds the inline DOM for
 * an annotated line (real annotation card or the pending composer). Kept a
 * single bag so it spreads into the option object only when commenting is on —
 * the read-only view passes nothing and stays byte-identical. The built-in
 * gutter `+` is used (no custom renderGutterUtility), so the WebKit #308027
 * combination with hunkSeparators:'line-info' cannot arise. */
export interface SourceViewGutter {
  enableGutterUtility: true;
  // Lets the reviewer drag (or shift-click) the line-number column to select a
  // span; the gutter `+` then reports that range, so a comment can cover several
  // lines rather than only the one it hovers.
  enableLineSelection: true;
  onGutterUtilityClick(range: SelectedLineRange): void;
  // Live during a drag: the library fires these as the line selection grows or
  // shrinks (start when the gesture begins, change on every row crossed, end on
  // release/cancel with a null range). A view bridges them to preview the range
  // before release; `range` is null when the selection clears. Optional — the
  // gutter `+` works without them, so a view that wants no live readout omits them.
  onLineSelectionStart?(range: SelectedLineRange | null): void;
  onLineSelectionChange?(range: SelectedLineRange | null): void;
  onLineSelectionEnd?(range: SelectedLineRange | null): void;
  renderAnnotation(annotation: LineAnnotation): HTMLElement | undefined;
}

/** Library options for the single-document view (module-internal). */
export type SourceViewLibOptions = FileOptions<undefined>;

/** Library options for the diff view (module-internal). */
export type SourceDiffViewLibOptions = FileDiffOptions<undefined>;

// The keys both views share (from the library's BaseCodeOptions); typed as a
// Pick so the diff mapper can spread it without dragging in File-only option
// types that conflict with FileDiff's. The Shiki theme is fixed by the bridge
// (caret's themes), not consumer-chosen, so it's folded in here rather than
// surfaced on the caret-domain options.
function sharedOptions(
  options: SourceViewOptions,
): Pick<SourceViewLibOptions, "overflow" | "disableLineNumbers" | "theme" | "themeType"> {
  return {
    overflow: options.overflow,
    disableLineNumbers: options.disableLineNumbers,
    theme: caretDiffTheme.theme,
    themeType: caretDiffTheme.themeType,
  };
}

export function toFileOptions(
  options: SourceViewOptions,
  linkHandlers?: LinkHandlers,
  gutter?: SourceViewGutter,
  onLineClick?: SourceViewLibOptions["onLineClick"],
): SourceViewLibOptions {
  // Link handlers are stable for the instance's life (they close over the span
  // map), so they belong only in the initial options — a content-key change
  // recreates the instance with a fresh map. When absent, the option object is
  // unchanged, so views without the link layer behave exactly as before. The
  // gutter bag spreads the same way: present only when the view enables
  // commenting, absent (and byte-identical) on the read-only view.
  //
  // useTokenTransformer must be set explicitly whenever the token handlers are
  // present: the library only derives it from the handlers on the first render,
  // and its renderer-options projection drops the handlers on every later
  // render, so without the explicit flag the per-token `data-char` markers stop
  // being emitted and token clicks/hovers no longer resolve to a link span.
  //
  // onLineClick lets a plain click anywhere on a line open a comment composer; it
  // spreads in only when the view wires it, so the read-only view stays unchanged.
  const tokenInteractions = linkHandlers != null ? { useTokenTransformer: true } : undefined;
  const lineClick = onLineClick != null ? { onLineClick } : undefined;
  return {
    ...sharedOptions(options),
    ...tokenInteractions,
    ...linkHandlers,
    ...gutter,
    ...lineClick,
  };
}

export function toFileDiffOptions(options: SourceDiffViewOptions): SourceDiffViewLibOptions {
  return {
    ...sharedOptions(options),
    diffStyle: options.diffStyle,
    diffIndicators: options.diffIndicators,
    // Collapsed context renders as the library's line-info separator: a band on
    // caret's separator surface (--diffs-bg-separator-override, owned by the
    // .diffview bridge in app.css) carrying the 'N unmodified lines' label and the
    // rounded expand pills. Both values match the library defaults today and are
    // pinned here so a library default flip can't silently change the rethemed
    // surface — hunkSeparators stays 'line-info' so the band keeps its caret skin,
    // and expandUnchanged stays false so context keeps collapsing (the band and
    // its pills only exist while context is hidden). Compare mode (SourceDiffView →
    // FileDiff, constructed with no enableGutterUtility) has no gutter, so the
    // WebKit gutter-`+`/line-info interaction the read-write view guards against
    // cannot arise here.
    hunkSeparators: "line-info",
    expandUnchanged: false,
  };
}
