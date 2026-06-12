// Maps caret-domain view options to complete @pierre/diffs option objects.
// The library's setOptions replaces its options wholesale (no merging), so
// each mapper emits every key it owns — passing the result to setOptions is
// always a faithful full replacement.
import type { FileDiffOptions, FileOptions } from "@pierre/diffs";
import type { SourceDiffViewOptions, SourceViewOptions } from "./types.ts";

/** Library options for the single-document view (module-internal). */
export type SourceViewLibOptions = FileOptions<undefined>;

/** Library options for the diff view (module-internal). */
export type SourceDiffViewLibOptions = FileDiffOptions<undefined>;

// The keys both views share (from the library's BaseCodeOptions); typed as a
// Pick so the diff mapper can spread it without dragging in File-only option
// types that conflict with FileDiff's.
function sharedOptions(
  options: SourceViewOptions,
): Pick<SourceViewLibOptions, "overflow" | "disableLineNumbers"> {
  return {
    overflow: options.overflow,
    disableLineNumbers: options.disableLineNumbers,
  };
}

export function toFileOptions(options: SourceViewOptions): SourceViewLibOptions {
  return sharedOptions(options);
}

export function toFileDiffOptions(options: SourceDiffViewOptions): SourceDiffViewLibOptions {
  return {
    ...sharedOptions(options),
    diffStyle: options.diffStyle,
  };
}
