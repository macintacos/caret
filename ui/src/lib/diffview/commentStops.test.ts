import { describe, expect, test } from "bun:test";

import {
  type CommentStop,
  commentKeys,
  crossedStop,
  deriveStops,
  sameStop,
  stepComment,
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

describe("stepComment", () => {
  // a(3) b(3) resume:m(5) c(7)
  const stops = deriveStops(
    [thread(3, ["a", 3], ["b", 3]), thread(7, ["c", 7])],
    [marker("m", 5, 5)],
    identity,
  );
  const at = (i: number) => refs(stops)[i];

  test("steps from a comment to the next, skipping Resume markers", () => {
    expect(at(stepComment(stops, { stop: 1 }, 1))).toBe("c");
    expect(at(stepComment(stops, { stop: 3 }, -1))).toBe("b");
  });

  test("wraps at either end", () => {
    expect(at(stepComment(stops, { stop: 3 }, 1))).toBe("a");
    expect(at(stepComment(stops, { stop: 0 }, -1))).toBe("c");
  });

  test("from a Resume marker, steps to the comments around it", () => {
    expect(at(stepComment(stops, { stop: 2 }, 1))).toBe("c");
    expect(at(stepComment(stops, { stop: 2 }, -1))).toBe("b");
  });

  test("]c from a line before, on, and after a comment's slot", () => {
    expect(at(stepComment(stops, { slot: 2 }, 1))).toBe("a");
    expect(at(stepComment(stops, { slot: 3 }, 1))).toBe("a");
    expect(at(stepComment(stops, { slot: 4 }, 1))).toBe("c");
  });

  test("[c from a line before, on, and after a comment's slot", () => {
    expect(at(stepComment(stops, { slot: 2 }, -1))).toBe("c");
    expect(at(stepComment(stops, { slot: 3 }, -1))).toBe("c");
    expect(at(stepComment(stops, { slot: 4 }, -1))).toBe("b");
  });

  test("is -1 with no comments", () => {
    const onlyResume = deriveStops([], [marker("m", 1, 1)], identity);
    expect(stepComment(onlyResume, { slot: 1 }, 1)).toBe(-1);
    expect(stepComment(onlyResume, { stop: 0 }, -1)).toBe(-1);
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

describe("commentKeys", () => {
  const ALL = ["edit", "editInsert", "activate", "collapse", "expand", "discard"];
  const sorted = (ids: string[]) => [...ids].sort();

  test("a draft comment takes every comment key, collapsed or expanded", () => {
    expect(sorted(commentKeys({ kind: "comment" }, false))).toEqual(sorted(ALL));
    expect(sorted(commentKeys({ kind: "comment", state: "pending" }, true))).toEqual(sorted(ALL));
  });

  test("an accepted or expired comment only folds, and Enter expands it while collapsed", () => {
    for (const state of ["approved", "expired"] as const) {
      expect(sorted(commentKeys({ kind: "comment", state }, false))).toEqual(
        sorted(["collapse", "expand", "activate"]),
      );
      expect(sorted(commentKeys({ kind: "comment", state }, true))).toEqual(
        sorted(["collapse", "expand"]),
      );
    }
  });

  test("a Resume marker takes Enter only", () => {
    expect(commentKeys({ kind: "resume" }, false)).toEqual(["activate"]);
  });
});
