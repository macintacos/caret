// Maps caret-domain view options to complete @pierre/diffs option objects.
// The library's setOptions replaces its options wholesale (no merging), so
// each mapper emits every key it owns — passing the result to setOptions is
// always a faithful full replacement.
import type { FileDiffOptions, FileOptions } from "@pierre/diffs";
import type { LinkHandlers } from "./linkInteractions.ts";
import { caretDiffTheme } from "./theme.ts";
import type { SourceDiffViewOptions, SourceViewOptions } from "./types.ts";

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
): SourceViewLibOptions {
  // Link handlers are stable for the instance's life (they close over the span
  // map), so they belong only in the initial options — a content-key change
  // recreates the instance with a fresh map. When absent, the option object is
  // unchanged, so views without the link layer behave exactly as before.
  return { ...sharedOptions(options), ...linkHandlers };
}

export function toFileDiffOptions(options: SourceDiffViewOptions): SourceDiffViewLibOptions {
  return {
    ...sharedOptions(options),
    diffStyle: options.diffStyle,
  };
}
