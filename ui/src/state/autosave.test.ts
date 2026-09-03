import "@ui/support/setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";

import type { Annotation, ClientReview, PersistedScratch } from "@core/lib/types";
import { type AutosaveStore, createAutosave } from "@/state/autosave.svelte.ts";
import { HttpError } from "@/state/resolve.svelte.ts";

// One recorded PUT /draft call.
interface SaveCall {
  id: string;
  annotations: Annotation[];
  generalCommentDraft: string;
  composerScratches: PersistedScratch[];
  version?: number;
}

// A manual timer: createAutosave's debounce is driven by `setTimer`/`clearTimer`
// so tests fire the flush deterministically instead of sleeping (cf.
// doc/agents/browser-testing.md's "inject the clock" rule).
function makeTimer() {
  let pending: (() => void) | null = null;
  let nextHandle = 1;
  return {
    setTimer: (fn: () => void) => {
      pending = fn;
      return nextHandle++ as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      pending = null;
    },
    armed: () => pending !== null,
    fire: () => {
      const fn = pending;
      pending = null;
      fn?.();
    },
  };
}

// A working-copy review with the fields syncActive reads.
function review(over: Partial<ClientReview>): ClientReview {
  return {
    id: "r1",
    version: 1,
    annotations: [],
    generalCommentDraft: "",
    composerScratches: [],
    ...over,
  } as ClientReview;
}

function scratch(startLine: number, text: string): PersistedScratch {
  return { startLine, endLine: startLine, text };
}

function ann(id: string, comment = ""): Annotation {
  return { id, blockId: "b0", startOffset: 0, endOffset: 1, quote: "q", comment };
}

function makeStore(over: Partial<AutosaveStore> = {}): AutosaveStore {
  return {
    annotations: [],
    generalCommentDraft: "",
    composerScratches: [],
    focusedAnnotation: null,
    ...over,
  };
}

let saves: SaveCall[];
let saveResult: () => Promise<void>;

function build(store: AutosaveStore, activeId: () => string | null, timer = makeTimer()) {
  let offline = false;
  const autosave = createAutosave(store, activeId, {
    putDraft: async (id, draft) => {
      saves.push({
        id,
        annotations: draft.annotations,
        generalCommentDraft: draft.generalCommentDraft,
        composerScratches: draft.composerScratches,
        version: draft.version,
      });
      return saveResult();
    },
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
    onOffline: () => {
      offline = true;
    },
  });
  return { autosave, timer, wentOffline: () => offline };
}

beforeEach(() => {
  saves = [];
  saveResult = () => Promise.resolve();
});

describe("debounced autosave", () => {
  test("an edit schedules a save that fires on the debounce", () => {
    const store = makeStore();
    const { autosave, timer } = build(store, () => "r1");
    autosave.createLineAnnotation({ startLine: 1, endLine: 1, comment: "c" });
    expect(timer.armed()).toBe(true);
    expect(saves).toHaveLength(0);
    timer.fire();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.id).toBe("r1");
    expect(saves[0]!.annotations).toHaveLength(1);
  });

  test("rapid edits coalesce into a single flush", () => {
    const store = makeStore();
    const { autosave, timer } = build(store, () => "r1");
    autosave.editGeneralComment("a");
    autosave.editGeneralComment("ab");
    autosave.editGeneralComment("abc");
    timer.fire();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.generalCommentDraft).toBe("abc");
  });

  test("no save is scheduled when nothing is active", () => {
    const store = makeStore();
    const { autosave, timer } = build(store, () => null);
    autosave.editGeneralComment("hi");
    expect(timer.armed()).toBe(false);
  });

  test("a whitespace-only draft is persisted as empty", async () => {
    const store = makeStore();
    const { autosave } = build(store, () => "r1");
    autosave.editGeneralComment("   \n  ");
    await autosave.flushPending();
    expect(saves[0]!.generalCommentDraft).toBe("");
  });

  test("flushPending is a no-op when nothing is pending", async () => {
    const store = makeStore();
    const { autosave } = build(store, () => "r1");
    await autosave.flushPending();
    expect(saves).toHaveLength(0);
  });

  /** Edit the general comment and flush it under the current saveResult. */
  async function editAndFlush() {
    const store = makeStore();
    const { autosave, wentOffline } = build(store, () => "r1");
    autosave.editGeneralComment("x");
    await autosave.flushPending();
    return { autosave, wentOffline };
  }

  test("a non-2xx response does not flip the daemon offline", async () => {
    saveResult = () => Promise.reject(new HttpError(409));
    const { wentOffline } = await editAndFlush();
    expect(wentOffline()).toBe(false);
  });

  test("a network failure flips the daemon offline", async () => {
    saveResult = () => Promise.reject(new Error("network down"));
    const { wentOffline } = await editAndFlush();
    expect(wentOffline()).toBe(true);
  });
});

describe("flushPending snapshots before await", () => {
  test("a review switch mid-flush cannot redirect the save onto the new review", async () => {
    const store = makeStore({ annotations: [ann("a1", "c")] });
    let active = "r1";
    const { autosave } = build(store, () => active);
    autosave.editGeneralComment("draft-for-r1");
    // Begin the flush, then synchronously mutate the working copy + active id as
    // a switch would — the in-flight save must carry r1's snapshot, not r2's.
    const flushing = autosave.flushPending();
    active = "r2";
    store.annotations = [ann("z9", "other")];
    store.generalCommentDraft = "draft-for-r2";
    await flushing;
    expect(saves).toHaveLength(1);
    expect(saves[0]!.id).toBe("r1");
    expect(saves[0]!.annotations.map((a) => a.id)).toEqual(["a1"]);
    expect(saves[0]!.generalCommentDraft).toBe("draft-for-r1");
  });
});

describe("syncActive seed guards", () => {
  test("annotations reload on an id change", () => {
    const store = makeStore();
    const { autosave } = build(store, () => "r1");
    autosave.syncActive(review({ id: "r1", version: 1, annotations: [ann("a1")] }));
    expect(store.annotations.map((a) => a.id)).toEqual(["a1"]);
    autosave.syncActive(review({ id: "r2", version: 1, annotations: [ann("b2")] }));
    expect(store.annotations.map((a) => a.id)).toEqual(["b2"]);
  });

  test("annotations reload on a version bump of the same review", () => {
    const store = makeStore();
    const { autosave } = build(store, () => "r1");
    autosave.syncActive(review({ id: "r1", version: 1, annotations: [ann("a1")] }));
    autosave.syncActive(review({ id: "r1", version: 2, annotations: [ann("v2")] }));
    expect(store.annotations.map((a) => a.id)).toEqual(["v2"]);
  });

  test("annotations do NOT reload when id:version is unchanged (poll churn)", () => {
    const store = makeStore();
    const { autosave } = build(store, () => "r1");
    autosave.syncActive(review({ id: "r1", version: 1, annotations: [ann("a1")] }));
    // Locally edit the working copy, then a poll re-delivers the same id:version.
    store.annotations = [ann("a1", "local edit")];
    autosave.syncActive(review({ id: "r1", version: 1, annotations: [ann("a1")] }));
    // The local edit survives — no stomp.
    expect(store.annotations[0]!.comment).toBe("local edit");
  });

  test("the draft seeds on an id change only — not on a version bump", () => {
    const store = makeStore();
    const { autosave } = build(store, () => "r1");
    autosave.syncActive(review({ id: "r1", version: 1, generalCommentDraft: "seed-1" }));
    expect(store.generalCommentDraft).toBe("seed-1");
    // A user types into the draft, then a revision (new version, same id) arrives.
    store.generalCommentDraft = "live keystrokes";
    autosave.syncActive(
      review({ id: "r1", version: 2, generalCommentDraft: "seed-1", annotations: [ann("v2")] }),
    );
    // The draft is NOT re-seeded — the live text survives.
    expect(store.generalCommentDraft).toBe("live keystrokes");
  });

  test("the draft re-seeds when the review id changes", () => {
    const store = makeStore();
    const { autosave } = build(store, () => "r1");
    autosave.syncActive(review({ id: "r1", version: 1, generalCommentDraft: "seed-1" }));
    store.generalCommentDraft = "edited";
    autosave.syncActive(review({ id: "r2", version: 1, generalCommentDraft: "seed-2" }));
    expect(store.generalCommentDraft).toBe("seed-2");
  });

  test("a missing draft seeds as empty string", () => {
    const store = makeStore();
    const { autosave } = build(store, () => "r1");
    autosave.syncActive(review({ id: "r1", version: 1, generalCommentDraft: undefined }));
    expect(store.generalCommentDraft).toBe("");
  });

  test("going inactive flushes, clears the working copy, and resets the guards", async () => {
    const store = makeStore();
    let active: string | null = "r1";
    const { autosave } = build(store, () => active);
    autosave.syncActive(review({ id: "r1", version: 1, generalCommentDraft: "seed" }));
    autosave.editGeneralComment("pending"); // schedules a save for r1
    active = null;
    autosave.syncActive(null);
    expect(store.annotations).toEqual([]);
    expect(store.generalCommentDraft).toBe("");
  });
});

describe("flush-before-switch ordering", () => {
  test("switching reviews flushes the previous review's pending save first", () => {
    const store = makeStore();
    const { autosave } = build(store, () => "r1");
    autosave.syncActive(review({ id: "r1", version: 1 }));
    autosave.editGeneralComment("r1-draft"); // pending save for r1
    // Switch to r2: the pending r1 save must flush BEFORE the working copy is
    // overwritten, so it carries r1's id and draft (not r2's).
    autosave.syncActive(review({ id: "r2", version: 1, generalCommentDraft: "r2-seed" }));
    expect(saves).toHaveLength(1);
    expect(saves[0]!.id).toBe("r1");
    expect(saves[0]!.generalCommentDraft).toBe("r1-draft");
  });
});

describe("line-anchored create", () => {
  test("a single-line create pushes a line annotation and schedules a save", () => {
    const store = makeStore();
    const { autosave, timer } = build(store, () => "r1");
    autosave.createLineAnnotation({ startLine: 4, endLine: 4, comment: "fix this line" });
    expect(timer.armed()).toBe(true);
    const created = store.annotations[0]!;
    expect(created).toMatchObject({ startLine: 4, endLine: 4, comment: "fix this line" });
    expect(typeof created.id).toBe("string");
    expect(created.id.length).toBeGreaterThan(0);
    expect(store.focusedAnnotation).toBe(created.id);
    timer.fire();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.annotations).toHaveLength(1);
  });

  test("a range create persists the correct startLine and endLine", () => {
    const store = makeStore();
    const { autosave } = build(store, () => "r1");
    autosave.createLineAnnotation({ startLine: 7, endLine: 12, comment: "this block" });
    expect(store.annotations[0]).toMatchObject({ startLine: 7, endLine: 12 });
  });

  test("a line-anchored create appends without disturbing existing annotations", () => {
    const store = makeStore({ annotations: [ann("a1", "legacy")] });
    const { autosave } = build(store, () => "r1");
    autosave.createLineAnnotation({ startLine: 2, endLine: 2, comment: "second" });
    expect(store.annotations.map((a) => a.id)[0]).toBe("a1");
    expect(store.annotations).toHaveLength(2);
  });
});

describe("annotation CRUD", () => {
  test("delete clears focus when the deleted annotation was focused", () => {
    const store = makeStore({ annotations: [ann("a1"), ann("a2")], focusedAnnotation: "a1" });
    const { autosave } = build(store, () => "r1");
    autosave.deleteAnnotation("a1");
    expect(store.annotations.map((a) => a.id)).toEqual(["a2"]);
    expect(store.focusedAnnotation).toBe(null);
  });

  test("edit updates the matching annotation's comment", () => {
    const store = makeStore({ annotations: [ann("a1", "old")] });
    const { autosave } = build(store, () => "r1");
    autosave.editAnnotation("a1", "new");
    expect(store.annotations[0]!.comment).toBe("new");
  });

  test("clearGeneralComment empties the draft", () => {
    const store = makeStore({ generalCommentDraft: "sent" });
    const { autosave } = build(store, () => "r1");
    autosave.clearGeneralComment();
    expect(store.generalCommentDraft).toBe("");
  });
});

describe("composer scratches", () => {
  test("setScratches schedules a save carrying the scratches", () => {
    const store = makeStore();
    const { autosave, timer } = build(store, () => "r1");
    autosave.setScratches([scratch(2, "wip")]);
    expect(timer.armed()).toBe(true);
    timer.fire();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.composerScratches).toEqual([scratch(2, "wip")]);
  });

  test("setScratches does not reschedule when the scratches are unchanged", () => {
    // The controller reseeds on load / switch / version change, echoing the just-
    // served set back through App's onChange mirror. An unchanged set must not schedule
    // a redundant PUT (nor flip pendingSaveId onto the freshly-seeded review).
    const store = makeStore({ composerScratches: [scratch(2, "wip")] });
    const { autosave, timer } = build(store, () => "r1");
    autosave.setScratches([scratch(2, "wip")]); // structurally equal → no-op
    expect(timer.armed()).toBe(false);
    expect(saves).toHaveLength(0);
  });

  test("flushPending sends the scratches alongside annotations and the draft", async () => {
    const store = makeStore();
    const { autosave } = build(store, () => "r1");
    autosave.setScratches([scratch(5, "here")]);
    autosave.editGeneralComment("gc");
    await autosave.flushPending();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.composerScratches).toEqual([scratch(5, "here")]);
    expect(saves[0]!.generalCommentDraft).toBe("gc");
  });

  test("flushPending stamps the version the scratch was composed against", async () => {
    // The daemon drops a scratch write whose version is stale, so the save must
    // carry the version the reviewer was viewing when they typed.
    const store = makeStore();
    const { autosave } = build(store, () => "r1");
    autosave.syncActive(review({ id: "r1", version: 3, composerScratches: [] }));
    autosave.setScratches([scratch(2, "wip")]);
    await autosave.flushPending();
    expect(saves[0]!.version).toBe(3);
  });

  test("setScratches strips the controller's derived key before persisting", () => {
    const store = makeStore();
    const { autosave, timer } = build(store, () => "r1");
    // The source-view controller emits ComposerScratch objects (with a `key`);
    // the persisted PersistedScratch shape must not carry it.
    autosave.setScratches([
      { key: "2:2", startLine: 2, endLine: 2, text: "wip" } as PersistedScratch,
    ]);
    timer.fire();
    expect(saves[0]!.composerScratches).toEqual([scratch(2, "wip")]);
    expect(saves[0]!.composerScratches[0]).not.toHaveProperty("key");
  });

  test("syncActive seeds the store's scratches on an id:version change", () => {
    const store = makeStore();
    const { autosave } = build(store, () => "r1");
    autosave.syncActive(review({ id: "r1", version: 1, composerScratches: [scratch(3, "seed")] }));
    expect(store.composerScratches).toEqual([scratch(3, "seed")]);
    // A new version reloads them (version-scoped, like annotations).
    autosave.syncActive(review({ id: "r1", version: 2, composerScratches: [scratch(7, "v2")] }));
    expect(store.composerScratches).toEqual([scratch(7, "v2")]);
  });

  test("syncActive does not re-seed scratches on a same-id:version poll tick", () => {
    const store = makeStore();
    const { autosave } = build(store, () => "r1");
    autosave.syncActive(review({ id: "r1", version: 1, composerScratches: [scratch(3, "seed")] }));
    // The user types locally; the 2s poll re-delivers the same id:version.
    store.composerScratches = [scratch(3, "live edit")];
    autosave.syncActive(review({ id: "r1", version: 1, composerScratches: [scratch(3, "seed")] }));
    expect(store.composerScratches).toEqual([scratch(3, "live edit")]);
  });

  test("a review switch mid-flush cannot redirect the scratches onto the new review", async () => {
    const store = makeStore();
    let active = "r1";
    const { autosave } = build(store, () => active);
    autosave.setScratches([scratch(1, "r1-scratch")]);
    const flushing = autosave.flushPending();
    active = "r2";
    store.composerScratches = [scratch(9, "r2-scratch")];
    await flushing;
    expect(saves).toHaveLength(1);
    expect(saves[0]!.id).toBe("r1");
    expect(saves[0]!.composerScratches).toEqual([scratch(1, "r1-scratch")]);
  });
});
