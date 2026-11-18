import { describe, expect, test } from "bun:test";

import {
  type CommentStop,
  crossedStop,
  deriveStops,
  sameStop,
  stopNeighbour,
} from "$lib/diffview/commentStops.ts";

describe("sameStop", () => {
  test("matches the same kind and id", () => {
    expect(sameStop({ kind: "comment", id: "a" }, { kind: "comment", id: "a" })).toBe(true);
    expect(sameStop({ kind: "resume", key: "k" }, { kind: "resume", key: "k" })).toBe(true);
  });

  test("differs on a different id", () => {
    expect(sameStop({ kind: "comment", id: "a" }, { kind: "comment", id: "b" })).toBe(false);
  });

  test("a comment never matches a resume marker", () => {
    expect(sameStop({ kind: "comment", id: "a" }, { kind: "resume", key: "a" })).toBe(false);
  });
});

const thread = (line: number, ...ids: [string, number][]) => ({
  line,
  annotations: ids.map(([id, startLine]) => ({ id, startLine, endLine: line })),
});
const marker = (key: string, startLine: number, endLine: number) => ({ key, startLine, endLine });
const refs = (stops: CommentStop[]) =>
  stops.map((s) => (s.ref.kind === "comment" ? s.ref.id : `resume:${s.ref.key}`));
const identity = (line: number) => line;

describe("deriveStops", () => {
  test("orders source stops by line", () => {
    const stops = deriveStops([thread(9, ["b", 9]), thread(2, ["a", 1])], [], identity);
    expect(refs(stops)).toEqual(["a", "b"]);
    expect(stops[0]).toEqual({ ref: { kind: "comment", id: "a" }, start: 1, line: 2, slot: 2 });
  });

  test("orders preview stops by slot, then by the line they end on", () => {
    // Lines 1–5 render as one block (slot 0); line 6 starts the next.
    const slotOf = (line: number) => (line <= 5 ? 0 : 1);
    const stops = deriveStops(
      [thread(6, ["c", 6]), thread(4, ["b", 4]), thread(2, ["a", 2])],
      [],
      slotOf,
    );
    expect(refs(stops)).toEqual(["a", "b", "c"]);
    expect(stops.map((s) => s.slot)).toEqual([0, 0, 1]);
  });

  test("keeps a thread's comments in display order", () => {
    expect(refs(deriveStops([thread(3, ["x", 3], ["y", 1])], [], identity))).toEqual(["x", "y"]);
  });

  test("puts Resume markers after their line's thread, by first line", () => {
    const stops = deriveStops(
      [thread(3, ["a", 3])],
      [marker("m2", 2, 3), marker("m1", 1, 3)],
      identity,
    );
    expect(refs(stops)).toEqual(["a", "resume:m1", "resume:m2"]);
  });

  test("carries a comment's state", () => {
    const t = {
      line: 1,
      annotations: [{ id: "a", startLine: 1, endLine: 1, state: "approved" as const }],
    };
    expect(deriveStops([t], [], identity)[0]?.state).toBe("approved");
  });
});

describe("crossedStop", () => {
  const stops = deriveStops([thread(3, ["a", 3], ["b", 3]), thread(5, ["c", 5])], [], identity);

  test("down from a stop's line enters its first comment", () => {
    expect(crossedStop(stops, 3, 4, 1)).toBe(0);
  });

  test("up from the next line enters its last comment", () => {
    expect(crossedStop(stops, 4, 3, -1)).toBe(1);
  });

  test("a move between lines with no comment crosses nothing", () => {
    expect(crossedStop(stops, 1, 2, 1)).toBe(-1);
    expect(crossedStop(stops, 3, 2, -1)).toBe(-1);
  });

  test("a move within one preview block crosses nothing", () => {
    expect(crossedStop(stops, 3, 3, 1)).toBe(-1);
  });

  test("down from the last line reaches a comment on it", () => {
    expect(crossedStop(stops, 5, null, 1)).toBe(2);
  });
});

describe("stopNeighbour", () => {
  const stops = deriveStops([thread(3, ["a", 3], ["b", 3]), thread(5, ["c", 5])], [], identity);

  test("steps to the next comment on the same slot", () => {
    expect(stopNeighbour(stops, 0, 1)).toBe(1);
    expect(stopNeighbour(stops, 1, -1)).toBe(0);
  });

  test("leaves the slot when no comment follows on it", () => {
    expect(stopNeighbour(stops, 1, 1)).toBe(-1);
    expect(stopNeighbour(stops, 0, -1)).toBe(-1);
    expect(stopNeighbour(stops, 2, -1)).toBe(-1);
  });
});
