// A comment stop is a cursor target that is not a line: a comment card, or a
// retained scratch's Resume marker.
import type { ReviewStatus } from "@core/lib/types";

export type StopRef = { kind: "comment"; id: string } | { kind: "resume"; key: string };

/** The hovered stop, with the last anchored line it had when the cursor landed. */
export interface FocusedStop {
  ref: StopRef;
  line: number;
}

export interface CommentStop {
  ref: StopRef;
  /** First anchored line. */
  start: number;
  /** Last anchored line. */
  line: number;
  /** Where it renders: the line on source, the block index on preview. */
  slot: number;
  /** Comments only. */
  state?: ReviewStatus;
}

/** The keyboard's handle on a mounted comment card; its state stays card-local. */
export interface CardHandle {
  expand: () => void;
  collapse: () => void;
  edit: () => void;
  discard: () => void;
  expanded: () => boolean;
}

/** Register a card's handle by comment id; returns its unregister. */
export type RegisterCard = (id: string, handle: CardHandle) => () => void;

export function sameStop(a: StopRef, b: StopRef): boolean {
  if (a.kind === "comment") return b.kind === "comment" && a.id === b.id;
  return b.kind === "resume" && a.key === b.key;
}
