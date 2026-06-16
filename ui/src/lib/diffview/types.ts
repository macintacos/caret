// Caret-domain types for the diff-view wrapper module. This module is the
// single owner of every `@pierre/diffs` import (enforced by
// import-boundary.test.ts); code outside it imports these caret-named types
// instead of the library's.
import type { DiffLineAnnotation, LineAnnotation } from "@pierre/diffs";

/** A document rendered in the source or diff view. */
export interface SourceDocument {
  /** Display name; also drives syntax-highlight language inference. */
  name: string;
  /** Full text of the document. */
  text: string;
}

/** Layout for a two-document diff: side-by-side or stacked. */
export type DiffStyle = "split" | "unified";

/** Gutter change markers for a diff: the inherited vertical bars, or the classic
 * +/- glyphs many reviewers prefer. (The library also offers "none"; caret has no
 * use for hiding the markers, so it isn't surfaced.) */
export type DiffIndicators = "bars" | "classic";

/** Line annotation on a single-document view. */
export type SourceLineAnnotation = LineAnnotation;

/** Line annotation on a diff view (carries the side it anchors to). */
export type SourceDiffLineAnnotation = DiffLineAnnotation;

/** Imperative handle a SourceView hands its parent once mounted. */
export interface SourceViewApi {
  /** Scrolls the view so the 1-based source line is at the top of the viewport.
   * Returns whether a matching row was found — false (a no-op) when the line is
   * outside the rendered range or the view has not painted yet. */
  scrollToLine(line: number): boolean;
  /** The view's host element (the shadow host). Light-DOM children projected
   * into its annotation slots render inline within the library's reserved rows
   * (see annotationSlot.ts). */
  host: HTMLElement;
}

/** Display options caret exposes for the single-document view. */
export interface SourceViewOptions {
  /** Line overflow behavior (library default: scroll). */
  overflow?: "scroll" | "wrap";
  /** Hide the line-number gutter. */
  disableLineNumbers?: boolean;
}

/** Display options caret exposes for the diff view. */
export interface SourceDiffViewOptions extends SourceViewOptions {
  /** Diff layout (library default: split). */
  diffStyle?: DiffStyle;
  /** Gutter change markers (library default: bars). Diff-only — the library exposes
   * this on FileDiff alone, so it lives here rather than on the shared base. */
  diffIndicators?: DiffIndicators;
}
