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

interface StopThread {
  line: number;
  annotations: readonly { id: string; startLine: number; endLine: number; state?: ReviewStatus }[];
}

interface StopMarker {
  key: string;
  startLine: number;
  endLine: number;
}

/** Every stop in render order: by slot, then line, then a line's thread before its Resume
 * markers. A thread keeps its display order; markers go by first line. */
export function deriveStops(
  threads: readonly StopThread[],
  markers: readonly StopMarker[],
  slotOf: (line: number) => number,
): CommentStop[] {
  const comments = threads.flatMap((t) =>
    t.annotations.map((a) => ({
      ref: { kind: "comment" as const, id: a.id },
      start: a.startLine,
      line: t.line,
      slot: slotOf(t.line),
      ...(a.state ? { state: a.state } : {}),
    })),
  );
  const resumes = [...markers]
    .sort((a, b) => a.startLine - b.startLine)
    .map((m) => ({
      ref: { kind: "resume" as const, key: m.key },
      start: m.startLine,
      line: m.endLine,
      slot: slotOf(m.endLine),
    }));
  const kindOrder = (s: CommentStop) => (s.ref.kind === "comment" ? 0 : 1);
  return [...comments, ...resumes].sort(
    (a, b) => a.slot - b.slot || a.line - b.line || kindOrder(a) - kindOrder(b),
  );
}

/** The stop a one-step move from slot `from` to slot `to` passes, or -1. Comments at a
 * slot render after it, so down enters the first at or after `from`, up the last before
 * it. A null `to` is the document's end, past every slot. */
export function crossedStop(
  stops: readonly CommentStop[],
  from: number,
  to: number | null,
  dir: 1 | -1,
): number {
  if (dir > 0) return stops.findIndex((s) => s.slot >= from && (to == null || s.slot < to));
  return stops.findLastIndex((s) => to != null && s.slot >= to && s.slot < from);
}

/** The next stop on stop `i`'s slot in `dir`, or -1 when the move leaves the slot. */
export function stopNeighbour(stops: readonly CommentStop[], i: number, dir: 1 | -1): number {
  const next = i + dir;
  return stops[next]?.slot === stops[i]?.slot ? next : -1;
}

export type CommentKey = "edit" | "editInsert" | "activate" | "collapse" | "expand" | "discard";

/** The `commenting.*` keys that act on a stop. A settled comment (Accepted, Expired) only
 * folds; a Resume marker only resumes. */
export function commentKeys(
  stop: { kind: StopRef["kind"]; state?: ReviewStatus },
  expanded: boolean,
): CommentKey[] {
  if (stop.kind === "resume") return ["activate"];
  if (stop.state === "approved" || stop.state === "expired") {
    return expanded ? ["collapse", "expand"] : ["collapse", "expand", "activate"];
  }
  return ["edit", "editInsert", "activate", "collapse", "expand", "discard"];
}

export function sameStop(a: StopRef, b: StopRef): boolean {
  if (a.kind === "comment") return b.kind === "comment" && a.id === b.id;
  return b.kind === "resume" && a.key === b.key;
}
