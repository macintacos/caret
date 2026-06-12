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

/** Line annotation on a single-document view. */
export type SourceLineAnnotation = LineAnnotation;

/** Line annotation on a diff view (carries the side it anchors to). */
export type SourceDiffLineAnnotation = DiffLineAnnotation;

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
}
