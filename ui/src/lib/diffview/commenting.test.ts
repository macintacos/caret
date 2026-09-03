import "@ui/test-setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";

import {
  type ComposerScratch,
  type CreatedAnchor,
  createSourceCommenting,
  normalizeRange,
  rangeLabel,
  scratchKey,
} from "$lib/diffview/commenting.ts";
import type { SoundEvent } from "$lib/sound.ts";

// The source-view gutter commenting controller is a pure state machine over the
// @pierre/diffs gutter utility: a SelectedLineRange opens it, submit/cancel
// drive the transitions, and submit with non-empty text creates a line-anchored
// {startLine, endLine} annotation. The composer DOM is a Svelte component
// (SourceComposer.svelte, covered by its own unit + the e2e); here we test the
// transitions in isolation.

let created: CreatedAnchor[];
let sounds: SoundEvent[];

function build() {
  created = [];
  sounds = [];
  return createSourceCommenting({
    onCreate: (a) => created.push(a),
    sound: (e) => sounds.push(e),
  });
}

beforeEach(() => {
  created = [];
  sounds = [];
});

/** Asserts the composer closed with nothing created and no scratch retained. */
function expectClosedClean(c: ReturnType<typeof build>): void {
  expect(created).toHaveLength(0);
  expect(c.pending()).toBeUndefined();
  expect(c.scratches()).toHaveLength(0);
}

/** Asserts nothing was created and exactly one scratch — matching `scratch` —
 * was retained at its range's key. */
function expectOnlyScratch(
  c: ReturnType<typeof build>,
  scratch: Omit<ComposerScratch, "key">,
): void {
  expect(created).toHaveLength(0);
  expect(c.pending()).toBeUndefined();
  expect(c.scratches()).toEqual([
    { key: scratchKey(scratch.startLine, scratch.endLine), ...scratch } satisfies ComposerScratch,
  ]);
}

describe("composer open/close state", () => {
  test("starts closed: no pending target", () => {
    const c = build();
    expect(c.pending()).toBeUndefined();
  });

  test("open(range) sets the pending range", () => {
    const c = build();
    c.open({ start: 5, end: 7 });
    expect(c.pending()).toEqual({ startLine: 5, endLine: 7 });
  });

  test("a single-line open has startLine === endLine", () => {
    const c = build();
    c.open({ start: 5, end: 5 });
    expect(c.pending()).toEqual({ startLine: 5, endLine: 5 });
  });

  test("open with a descending range normalizes start/end", () => {
    const c = build();
    c.open({ start: 9, end: 4 });
    expect(c.pending()).toEqual({ startLine: 4, endLine: 9 });
  });
});

describe("submit transition", () => {
  test("submit with text creates a single-line anchor and closes", () => {
    const c = build();
    c.open({ start: 3, end: 3 });
    c.submit("fix this");
    expect(created).toEqual([{ startLine: 3, endLine: 3, comment: "fix this" }]);
    expect(c.pending()).toBeUndefined();
  });

  test("submit with a range creates the correct startLine and endLine", () => {
    const c = build();
    c.open({ start: 8, end: 12 });
    c.submit("this block");
    expect(created).toEqual([{ startLine: 8, endLine: 12, comment: "this block" }]);
  });

  test("submit trims surrounding whitespace from the comment", () => {
    const c = build();
    c.open({ start: 2, end: 2 });
    c.submit("  spaced  ");
    expect(created[0]?.comment).toBe("spaced");
  });

  test("submit with empty/whitespace text cancels without creating", () => {
    const c = build();
    c.open({ start: 4, end: 4 });
    c.submit("   ");
    expect(created).toHaveLength(0);
    expect(c.pending()).toBeUndefined();
  });

  test("submit while closed is a no-op", () => {
    const c = build();
    c.submit("nothing open");
    expect(created).toHaveLength(0);
  });
});

describe("cancel transition", () => {
  test("cancel with no text closes the composer with no create and no scratch", () => {
    const c = build();
    c.open({ start: 6, end: 6 });
    c.cancel();
    expectClosedClean(c);
  });

  test("cancel with empty/whitespace text leaves no scratch (preserves current discard)", () => {
    const c = build();
    c.open({ start: 6, end: 6 });
    c.cancel("   ");
    expect(c.scratches()).toHaveLength(0);
  });

  test("cancel while closed is a no-op", () => {
    const c = build();
    expect(() => c.cancel()).not.toThrow();
    expect(c.pending()).toBeUndefined();
    expect(c.scratches()).toHaveLength(0);
  });
});

// discardOpen is the explicit-discard counterpart to cancel: the reviewer chose
// to drop the open draft, so it closes with no scratch retained (no "Resume"
// marker). cancel keeps non-empty text; discardOpen never does.
describe("discard the open composer", () => {
  test("discardOpen closes an open composer, retaining no scratch and creating nothing", () => {
    const c = build();
    c.open({ start: 6, end: 6 });
    c.discardOpen();
    expectClosedClean(c);
  });

  test("discardOpen drops a resumed scratch entirely, leaving no marker", () => {
    const c = build();
    c.open({ start: 5, end: 5 });
    c.cancel("kept for later"); // stash it as a scratch
    expect(c.scratches()).toHaveLength(1);
    c.resume(scratchKey(5, 5)); // consume the scratch back into the open composer
    c.discardOpen(); // discarding the resumed draft leaves nothing behind
    expectClosedClean(c);
  });

  test("discardOpen while closed is a no-op", () => {
    const c = build();
    expect(() => c.discardOpen()).not.toThrow();
    expect(c.pending()).toBeUndefined();
    expect(c.scratches()).toHaveLength(0);
  });

  test("discardOpen fires onChange once per real close, and not when already closed", () => {
    let ticks = 0;
    const c = createSourceCommenting({ onCreate: () => {}, onChange: () => ticks++ });
    c.open({ start: 1, end: 1 }); // 1
    c.discardOpen(); // 2 (closed the open composer)
    c.discardOpen(); // no-op — already closed
    expect(ticks).toBe(2);
  });
});

// An unsubmitted composer dismissed with typed text is retained as an in-memory
// scratch anchored to its range, so the reviewer can resume it. This is distinct
// from commentState.ts's "Draft" (a created, pending annotation) — a scratch was
// never added to the working copy; the marker offers "Resume", not "Draft".
describe("scratch drafts", () => {
  test("cancel with text retains a scratch keyed to the pending range", () => {
    const c = build();
    c.open({ start: 4, end: 6 });
    c.cancel("half a thought");
    expectOnlyScratch(c, { startLine: 4, endLine: 6, text: "half a thought" });
  });

  test("a scratch trims surrounding whitespace from the retained text", () => {
    const c = build();
    c.open({ start: 2, end: 2 });
    c.cancel("  spaced thought  ");
    expect(c.scratches()[0]?.text).toBe("spaced thought");
  });

  test("opening a scratched range restores its text and consumes the scratch", () => {
    const c = build();
    c.open({ start: 4, end: 6 });
    c.cancel("restore me");
    // Reopen the same range: the pending composer should seed from the scratch,
    // and the scratch is consumed (it moved into the open composer, not copied).
    c.open({ start: 4, end: 6 });
    expect(c.pending()).toEqual({ startLine: 4, endLine: 6 });
    expect(c.pendingText()).toBe("restore me");
    expect(c.scratches()).toHaveLength(0);
  });

  test("opening a range with no scratch seeds empty pending text", () => {
    const c = build();
    c.open({ start: 7, end: 7 });
    expect(c.pendingText()).toBe("");
  });

  test("resume reopens the composer at the scratch's range with its text", () => {
    const c = build();
    c.open({ start: 9, end: 9 });
    c.cancel("resume via marker");
    c.resume(scratchKey(9, 9));
    expect(c.pending()).toEqual({ startLine: 9, endLine: 9 });
    expect(c.pendingText()).toBe("resume via marker");
    expect(c.scratches()).toHaveLength(0);
  });

  test("resume with an unknown key is a no-op", () => {
    const c = build();
    expect(() => c.resume(scratchKey(1, 1))).not.toThrow();
    expect(c.pending()).toBeUndefined();
  });

  test("submitting an open composer clears any scratch for its range", () => {
    const c = build();
    c.open({ start: 3, end: 3 });
    c.cancel("started here");
    expect(c.scratches()).toHaveLength(1);
    c.open({ start: 3, end: 3 });
    c.submit("finished it");
    expect(created).toEqual([{ startLine: 3, endLine: 3, comment: "finished it" }]);
    expect(c.scratches()).toHaveLength(0);
  });

  test("an empty submit of a resumed composer leaves no scratch (the box was cleared)", () => {
    const c = build();
    c.open({ start: 5, end: 5 });
    c.cancel("typed then cleared");
    c.resume(scratchKey(5, 5));
    c.submit("   ");
    expect(created).toHaveLength(0);
    expect(c.scratches()).toHaveLength(0);
  });

  test("scratches on distinct ranges coexist", () => {
    const c = build();
    c.open({ start: 1, end: 1 });
    c.cancel("first");
    c.open({ start: 5, end: 8 });
    c.cancel("second");
    expect(c.scratches()).toEqual([
      { key: scratchKey(1, 1), startLine: 1, endLine: 1, text: "first" },
      { key: scratchKey(5, 8), startLine: 5, endLine: 8, text: "second" },
    ]);
  });

  test("onChange fires when a scratch is retained, resumed, and re-seeded", () => {
    let ticks = 0;
    const c = createSourceCommenting({ onCreate: () => {}, onChange: () => ticks++ });
    c.open({ start: 1, end: 1 }); // 1
    c.cancel("retain"); // 2 (close + store)
    c.resume(scratchKey(1, 1)); // 3 (reopen)
    c.seed([]); // 4 (empties + closes)
    expect(ticks).toBe(4);
  });
});

// On load — and whenever the rendered content changes (a new plan version, a
// review switch) — the host reseeds the controller from the review's persisted
// scratches, so a reload restores the reviewer's "Resume" markers instead of
// starting empty. seed() replaces the whole store and closes any open composer.
describe("seed (rehydrate persisted scratches)", () => {
  test("seed populates the store from persisted scratches, keyed by range", () => {
    const c = build();
    c.seed([
      { startLine: 2, endLine: 2, text: "one" },
      { startLine: 5, endLine: 8, text: "two" },
    ]);
    expect(c.scratches()).toEqual([
      { key: scratchKey(2, 2), startLine: 2, endLine: 2, text: "one" },
      { key: scratchKey(5, 8), startLine: 5, endLine: 8, text: "two" },
    ]);
  });

  test("a seeded scratch is resumable and restores its text", () => {
    const c = build();
    c.seed([{ startLine: 4, endLine: 6, text: "restore me" }]);
    c.resume(scratchKey(4, 6));
    expect(c.pending()).toEqual({ startLine: 4, endLine: 6 });
    expect(c.pendingText()).toBe("restore me");
  });

  test("seed replaces existing scratches and closes an open composer", () => {
    const c = build();
    c.open({ start: 1, end: 1 });
    c.cancel("stale");
    c.open({ start: 9, end: 9 }); // composer left open
    c.seed([{ startLine: 3, endLine: 3, text: "fresh" }]);
    expect(c.scratches()).toEqual([
      { key: scratchKey(3, 3), startLine: 3, endLine: 3, text: "fresh" },
    ]);
    expect(c.pending()).toBeUndefined();
  });

  test("seed([]) empties the store and closes any open composer", () => {
    const c = build();
    c.open({ start: 2, end: 2 });
    c.cancel("gone on new version");
    c.open({ start: 4, end: 4 });
    c.seed([]);
    expect(c.scratches()).toHaveLength(0);
    expect(c.pending()).toBeUndefined();
  });

  test("seed fires onChange", () => {
    let ticks = 0;
    const c = createSourceCommenting({ onCreate: () => {}, onChange: () => ticks++ });
    c.seed([{ startLine: 1, endLine: 1, text: "x" }]);
    expect(ticks).toBe(1);
  });
});

// The Request Changes dialog surfaces retained scratches with per-scratch Save
// and Discard. Save graduates a scratch to a committed annotation through the
// same onCreate path a submit uses, without opening the composer; Discard drops
// it with no annotation created.
describe("save and discard a scratch", () => {
  test("save graduates the scratch to an annotation via onCreate and drops it", () => {
    const c = build();
    c.open({ start: 3, end: 5 });
    c.cancel("commit me into the review");
    c.save(scratchKey(3, 5));
    expect(created).toEqual([{ startLine: 3, endLine: 5, comment: "commit me into the review" }]);
    expect(c.scratches()).toHaveLength(0);
  });

  test("save does not open the composer (a direct graduate, not a resume+submit)", () => {
    const c = build();
    c.open({ start: 2, end: 2 });
    c.cancel("finish this");
    c.save(scratchKey(2, 2));
    expect(c.pending()).toBeUndefined();
    expect(c.pendingText()).toBe("");
  });

  test("save leaves other scratches untouched", () => {
    const c = build();
    c.open({ start: 1, end: 1 });
    c.cancel("keep me");
    c.open({ start: 5, end: 8 });
    c.cancel("graduate me");
    c.save(scratchKey(5, 8));
    expect(created).toEqual([{ startLine: 5, endLine: 8, comment: "graduate me" }]);
    expect(c.scratches()).toEqual([
      { key: scratchKey(1, 1), startLine: 1, endLine: 1, text: "keep me" },
    ]);
  });

  test("save with an unknown key creates nothing and is a no-op", () => {
    const c = build();
    expect(() => c.save(scratchKey(9, 9))).not.toThrow();
    expect(created).toHaveLength(0);
  });

  test("discard drops only the named scratch and creates nothing", () => {
    const c = build();
    c.open({ start: 1, end: 1 });
    c.cancel("drop me");
    c.open({ start: 4, end: 4 });
    c.cancel("keep me");
    c.discard(scratchKey(1, 1));
    expect(created).toHaveLength(0);
    expect(c.scratches()).toEqual([
      { key: scratchKey(4, 4), startLine: 4, endLine: 4, text: "keep me" },
    ]);
  });

  test("discard with an unknown key is a no-op", () => {
    const c = build();
    c.open({ start: 2, end: 2 });
    c.cancel("still here");
    c.discard(scratchKey(7, 7));
    expect(c.scratches()).toHaveLength(1);
  });

  test("discard does not open the composer", () => {
    const c = build();
    c.open({ start: 2, end: 2 });
    c.cancel("drop this");
    c.discard(scratchKey(2, 2));
    expect(c.pending()).toBeUndefined();
  });

  test("save and discard each fire onChange once on a real mutation", () => {
    let ticks = 0;
    const c = createSourceCommenting({ onCreate: () => {}, onChange: () => ticks++ });
    c.open({ start: 1, end: 1 }); // 1
    c.cancel("a"); // 2
    c.open({ start: 3, end: 3 }); // 3
    c.cancel("b"); // 4
    c.save(scratchKey(1, 1)); // 5
    c.discard(scratchKey(3, 3)); // 6
    expect(ticks).toBe(6);
  });
});

// EXC-762: the Request Changes dialog can "mark as draft" a committed inline
// comment — demoting it out of the send and INTO the unsent-scratch section.
// draft() is the reverse of save(): it inserts a scratch directly from an
// annotation's range + comment, without touching the open composer.
describe("draft (demote an annotation into a scratch)", () => {
  test("inserts a scratch at the range, visible in scratches(), creating nothing", () => {
    const c = build();
    c.draft({ startLine: 4, endLine: 6, text: "reconsider this" });
    expectOnlyScratch(c, { startLine: 4, endLine: 6, text: "reconsider this" });
  });

  test("trims the demoted text", () => {
    const c = build();
    c.draft({ startLine: 2, endLine: 2, text: "  spaced  " });
    expect(c.scratches()[0]?.text).toBe("spaced");
  });

  test("a blank demote is a no-op (nothing to keep, no onChange)", () => {
    let ticks = 0;
    const c = createSourceCommenting({ onCreate: () => {}, onChange: () => ticks++ });
    c.draft({ startLine: 9, endLine: 9, text: "   " });
    expect(c.scratches()).toHaveLength(0);
    expect(ticks).toBe(0);
  });

  test("merges into an existing scratch at the same range so no unsent draft is lost", () => {
    const c = build();
    c.open({ start: 5, end: 5 });
    c.cancel("existing unsent draft");
    c.draft({ startLine: 5, endLine: 5, text: "demoted comment" });
    expect(c.scratches()).toEqual([
      {
        key: scratchKey(5, 5),
        startLine: 5,
        endLine: 5,
        text: "existing unsent draft\ndemoted comment",
      },
    ]);
  });

  test("leaves scratches on other ranges untouched", () => {
    const c = build();
    c.open({ start: 1, end: 1 });
    c.cancel("keep me");
    c.draft({ startLine: 5, endLine: 8, text: "demoted" });
    expect(c.scratches()).toEqual([
      { key: scratchKey(1, 1), startLine: 1, endLine: 1, text: "keep me" },
      { key: scratchKey(5, 8), startLine: 5, endLine: 8, text: "demoted" },
    ]);
  });

  test("does not open the composer", () => {
    const c = build();
    c.draft({ startLine: 2, endLine: 2, text: "x" });
    expect(c.pending()).toBeUndefined();
    expect(c.pendingText()).toBe("");
  });

  test("fires onChange once on a real insert", () => {
    let ticks = 0;
    const c = createSourceCommenting({ onCreate: () => {}, onChange: () => ticks++ });
    c.draft({ startLine: 1, endLine: 1, text: "x" });
    expect(ticks).toBe(1);
  });
});

describe("notifies on state change", () => {
  test("open, submit, and cancel fire the onChange callback", () => {
    let ticks = 0;
    const c = createSourceCommenting({ onCreate: () => {}, onChange: () => ticks++ });
    c.open({ start: 1, end: 1 });
    c.submit("x");
    c.open({ start: 2, end: 2 });
    c.cancel();
    expect(ticks).toBe(4);
  });
});

// The cues belong to the ACTIONS, so every path that opens the composer — the
// gutter drag, a line click, the `c` binding — sounds the same one without a
// caller writing it. resume() is deliberately not one of them: picking a Resume
// marker back up is a different affordance from initiating a comment, which is
// why the cue sits in open() rather than in the shared openAt.
describe("sound events (EXC-1126)", () => {
  test("open sounds the composer opening", () => {
    const c = build();
    c.open({ start: 3, end: 5 });
    expect(sounds).toEqual(["commentOpen"]);
  });

  test("resume is silent", () => {
    const c = build();
    c.open({ start: 3, end: 3 });
    c.cancel("kept for later");
    sounds.length = 0;
    c.resume(scratchKey(3, 3));
    expect(sounds).toEqual([]);
  });

  test("discardOpen with text throws away something, and sounds like it", () => {
    const c = build();
    c.open({ start: 3, end: 3 });
    sounds.length = 0;
    c.discardOpen("half a thought");
    expect(sounds).toEqual(["commentDiscarded"]);
  });

  test("discardOpen with whitespace-only text merely drops the composer", () => {
    const c = build();
    c.open({ start: 3, end: 3 });
    sounds.length = 0;
    c.discardOpen("   ");
    expect(sounds).toEqual(["commentDropped"]);
  });

  test("discardOpen with no text at all drops the composer", () => {
    const c = build();
    c.open({ start: 3, end: 3 });
    sounds.length = 0;
    c.discardOpen();
    expect(sounds).toEqual(["commentDropped"]);
  });

  test("discardOpen while closed is silent", () => {
    const c = build();
    c.discardOpen("typed into nothing");
    expect(sounds).toEqual([]);
  });

  test("the dep is optional — a controller with no sound still opens", () => {
    const c = createSourceCommenting({ onCreate: () => {} });
    c.open({ start: 1, end: 1 });
    expect(c.pending()).toEqual({ startLine: 1, endLine: 1 });
  });
});

// The shared normalization the live drag readout and the composer both read, so
// a preview while dragging and the label after release can never disagree.
describe("normalizeRange", () => {
  test("ascending range passes through", () => {
    expect(normalizeRange({ start: 3, end: 7 })).toEqual({ startLine: 3, endLine: 7 });
  });

  test("descending range (bottom-up drag) flips to ascending", () => {
    expect(normalizeRange({ start: 9, end: 4 })).toEqual({ startLine: 4, endLine: 9 });
  });

  test("single line normalizes to startLine === endLine", () => {
    expect(normalizeRange({ start: 5, end: 5 })).toEqual({ startLine: 5, endLine: 5 });
  });
});

describe("rangeLabel", () => {
  test("a single line reads 'Line N'", () => {
    expect(rangeLabel(3, 3)).toBe("Line 3");
  });

  test("a span reads 'Lines X–Y' with an en dash", () => {
    expect(rangeLabel(5, 8)).toBe("Lines 5–8");
  });
});
