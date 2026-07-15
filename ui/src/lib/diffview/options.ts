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

import type { ComposedTokenHandlers } from "$lib/diffview/linkInteractions.ts";
import { caretDiffTheme } from "$lib/diffview/theme.ts";
import type { SourceDiffViewOptions, SourceViewOptions } from "$lib/diffview/types.ts";

/** The gutter-utility opt-in plus its callbacks, supplied by a view that lets
 * the reviewer comment on a line. `renderAnnotation` builds the inline DOM for
 * an annotated line (real annotation card or the pending composer). Kept a
 * single bag so it spreads into the option object only when commenting is on —
 * the read-only view passes nothing and stays byte-identical. The built-in
 * gutter `+` is used (no custom renderGutterUtility), so the WebKit #308027
 * combination with hunkSeparators:'line-info' cannot arise. */
export interface SourceViewGutter {
  enableGutterUtility: true;
  // Light the hovered line so the whole line — not just the gutter edge — reads as
  // the comment target. The library sets `data-hovered` on the line element (and
  // its number); caret's `--diffs-bg-hover-override` (app.css) resolves that into a
  // subtle grey lift. "both" lifts the line and its number together so the row
  // brightens as one rather than leaving the number column detached.
  lineHoverHighlight: "both";
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
    // caret's theme selection forces light/dark; with none supplied the library
    // follows the system preference (caretDiffTheme.themeType) as before (EXC-730).
    themeType: options.scheme ?? caretDiffTheme.themeType,
  };
}

export function toFileOptions(
  options: SourceViewOptions,
  token?: ComposedTokenHandlers,
  gutter?: SourceViewGutter,
  onLineClick?: SourceViewLibOptions["onLineClick"],
): SourceViewLibOptions {
  // The token layer composes its single handler object (and the
  // useTokenTransformer flag those handlers require) in composeTokenHandlers;
  // here both spread in together so the flag can never drift apart from the
  // handlers. They are stable for the instance's life (they close over the span
  // map), so they belong only in the initial options — a content-key change
  // recreates the instance with a fresh map. When absent, the option object is
  // unchanged, so views without the link layer behave exactly as before. The
  // gutter bag spreads the same way: present only when the view enables
  // commenting, absent (and byte-identical) on the read-only view.
  //
  // onLineClick lets a plain click anywhere on a line open a comment composer; it
  // spreads in only when the view wires it, so the read-only view stays unchanged.
  const lineClick = onLineClick != null ? { onLineClick } : undefined;
  return {
    ...sharedOptions(options),
    ...token?.libOptions,
    ...token?.handlers,
    ...gutter,
    ...lineClick,
  };
}

export function toFileDiffOptions(options: SourceDiffViewOptions): SourceDiffViewLibOptions {
  return {
    ...sharedOptions(options),
    diffStyle: options.diffStyle,
    // The library only knows "bars"/"classic"/"none". caret's "both" drives it at
    // "bars" (the gutter bars) and overlays the +/- glyphs itself via the host's
    // data-caret-indicators="both" flag (SourceDiffView) + the matching rules in
    // coreStyles.ts, so the two cues show at once.
    diffIndicators: options.diffIndicators === "both" ? "bars" : options.diffIndicators,
    // Pin the compare header to the top of the scroll viewport. The library
    // renders a default file header for every diff; left to scroll, the version
    // pair and the +N/-N counts leave view the moment the reviewer scrolls a long
    // diff. Sticky keeps that context — the pair name and the change tallies —
    // anchored while reading. The pinned header fills over the code on its own
    // surface: [data-diffs-header][data-sticky] paints var(--diffs-bg), which the
    // .diffview bridge maps to caret's --paper-sunk.
    stickyHeader: true,
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
