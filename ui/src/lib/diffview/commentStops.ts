// A comment stop is a cursor target that is not a line: a comment card, or a
// retained scratch's Resume marker.
import type { ReviewStatus } from "@core/lib/types";

export type StopRef = { kind: "comment"; id: string } | { kind: "resume"; key: string };

/** The hovered stop, with the last anchored line it had when the cursor landed. */
export interface FocusedStop {
  ref: StopRef;
  line: number;
}

export type InputVia = "key" | "pointer";

type StopBase = {
  /** First anchored line. */
  start: number;
  /** Last anchored line. */
  line: number;
  /** Where it renders: the line on source; on preview, its gap's rank top to bottom (slotRanks). */
  slot: number;
};

export type CommentStop = StopBase &
  (
    | { ref: { kind: "comment"; id: string }; state?: ReviewStatus }
    | { ref: { kind: "resume"; key: string }; state?: never }
  );

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
 * markers. A thread keeps its display order; markers go by first line. Keep in step with
 * DiffPlanView's `previewSlots` and the source annotation row. */
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
      state: a.state,
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
 * it. A `to` of Infinity is the document's end, past every slot. */
export function crossedStop(
  stops: readonly CommentStop[],
  from: number,
  to: number,
  dir: 1 | -1,
): number {
  if (dir > 0) return stops.findIndex((s) => s.slot >= from && s.slot < to);
  return stops.findLastIndex((s) => s.slot >= to && s.slot < from);
}

/** The next stop on stop `i`'s slot in `dir`, or -1 when the move leaves the slot. */
export function stopNeighbour(stops: readonly CommentStop[], i: number, dir: 1 | -1): number {
  const next = i + dir;
  return stops[next]?.slot === stops[i]?.slot ? next : -1;
}

/** `]c`/`[c`: the index of the next or previous comment, skipping Resume markers and
 * wrapping at either end; -1 with no comments. From a position at `slot`, comments on
 * that slot count as ahead, since they render after it. */
export function stepComment(
  stops: readonly CommentStop[],
  from: { stop: number } | { slot: number },
  delta: 1 | -1,
): number {
  const [ahead, behind] =
    "stop" in from
      ? [(i: number) => i > from.stop, (i: number) => i < from.stop]
      : [
          (i: number) => (stops[i]?.slot ?? 0) >= from.slot,
          (i: number) => (stops[i]?.slot ?? 0) < from.slot,
        ];
  const commentIndices = stops.flatMap((s, i) => (s.ref.kind === "comment" ? [i] : []));
  if (commentIndices.length === 0) return -1;

  return delta > 0
    ? (commentIndices.find(ahead) ?? commentIndices[0] ?? -1)
    : (commentIndices.findLast(behind) ?? commentIndices.at(-1) ?? -1);
}

export const COMMENT_KEYS = [
  "edit",
  "editInsert",
  "activate",
  "collapse",
  "expand",
  "discard",
] as const;

/** The suffix of a `commenting.*` keymap id. */
export type CommentKey = (typeof COMMENT_KEYS)[number];

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
  return [...COMMENT_KEYS];
}

export function sameStop(a: StopRef, b: StopRef): boolean {
  if (a.kind === "comment") return b.kind === "comment" && a.id === b.id;
  return b.kind === "resume" && a.key === b.key;
}

/** A ref's id: the comment id, or the Resume marker's scratch key. */
export function stopKey(ref: StopRef): string {
  return ref.kind === "comment" ? ref.id : ref.key;
}

/** The index of `ref`'s stop in `stops`, or -1. */
export function stopIndex(stops: readonly CommentStop[], ref: StopRef): number {
  return stops.findIndex((s) => sameStop(s.ref, ref));
}

/** The anchored lines `c` comments on from a hovered stop: its first through last line. */
export function stopLines(
  stops: readonly CommentStop[],
  focused: FocusedStop,
): { start: number; end: number } {
  const stop = stops[stopIndex(stops, focused.ref)];
  return { start: stop?.start ?? focused.line, end: focused.line };
}
