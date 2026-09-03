import "@ui/support/setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";

import { versions } from "@ui/support/plan-versions.ts";
import { type CompareStore, createCompare } from "@/state/compare.svelte.ts";
import type { DiffIndicators, DiffStyle } from "$lib/diffview/types.ts";
import type { SoundEvent } from "$lib/sound.ts";

let written: DiffStyle[];
let prefValue: DiffStyle;
let writtenIndicators: DiffIndicators[];
let indicatorsPrefValue: DiffIndicators;
let sounds: SoundEvent[];

function makeStore(over: Partial<CompareStore> = {}): CompareStore {
  return {
    comparing: false,
    baseVersion: 0,
    targetVersion: 0,
    diffStyle: "split",
    diffIndicators: "bars",
    ...over,
  };
}

function build(store: CompareStore) {
  return createCompare(store, {
    readPref: () => prefValue,
    writePref: (s) => written.push(s),
    readIndicatorsPref: () => indicatorsPrefValue,
    writeIndicatorsPref: (i) => writtenIndicators.push(i),
    sound: (e) => sounds.push(e),
  });
}

beforeEach(() => {
  written = [];
  prefValue = "split";
  writtenIndicators = [];
  indicatorsPrefValue = "bars";
  sounds = [];
});

describe("init", () => {
  test("defaults base = current version and target = previous", () => {
    const store = makeStore();
    const compare = build(store);
    compare.init(versions(3));
    expect(store.baseVersion).toBe(3);
    expect(store.targetVersion).toBe(2);
  });

  test("loads the persisted diff style", () => {
    prefValue = "unified";
    const store = makeStore();
    const compare = build(store);
    compare.init(versions(3));
    expect(store.diffStyle).toBe("unified");
  });

  test("loads the persisted gutter indicators", () => {
    indicatorsPrefValue = "classic";
    const store = makeStore();
    const compare = build(store);
    compare.init(versions(3));
    expect(store.diffIndicators).toBe("classic");
  });

  test("canCompare is false with a single version", () => {
    const store = makeStore();
    const compare = build(store);
    compare.init(versions(1));
    expect(compare.canCompare(versions(1))).toBe(false);
  });

  test("canCompare is true with two or more versions", () => {
    const store = makeStore();
    const compare = build(store);
    compare.init(versions(2));
    expect(compare.canCompare(versions(2))).toBe(true);
  });
});

describe("selection", () => {
  test("any pair is selectable", () => {
    const store = makeStore();
    const compare = build(store);
    compare.init(versions(4));
    compare.setBase(2);
    compare.setTarget(1);
    expect(store.baseVersion).toBe(2);
    expect(store.targetVersion).toBe(1);
  });

  test("entering and leaving compare mode flips the flag", () => {
    const store = makeStore();
    const compare = build(store);
    compare.init(versions(3));
    compare.setComparing(true);
    expect(store.comparing).toBe(true);
    compare.setComparing(false);
    expect(store.comparing).toBe(false);
  });
});

describe("diff style", () => {
  test("toggling persists the new value", () => {
    const store = makeStore();
    const compare = build(store);
    compare.init(versions(3));
    compare.setDiffStyle("unified");
    expect(store.diffStyle).toBe("unified");
    expect(written).toEqual(["unified"]);
  });
});

describe("diff indicators", () => {
  test("toggling persists the new value", () => {
    const store = makeStore();
    const compare = build(store);
    compare.init(versions(3));
    compare.setDiffIndicators("classic");
    expect(store.diffIndicators).toBe("classic");
    expect(writtenIndicators).toEqual(["classic"]);
  });
});

describe("syncVersions", () => {
  test("a new version arriving while comparing keeps the existing pair valid", () => {
    const store = makeStore();
    const compare = build(store);
    compare.init(versions(3)); // base=3 target=2
    compare.setComparing(true);
    compare.setBase(2);
    compare.setTarget(1);
    // v4 arrives (a revision); the chosen 2-vs-1 pair still exists, so keep it.
    compare.syncVersions(versions(4));
    expect(store.baseVersion).toBe(2);
    expect(store.targetVersion).toBe(1);
    expect(store.comparing).toBe(true);
  });

  test("a vanished selected version resets to the default pair", () => {
    const store = makeStore();
    const compare = build(store);
    compare.init(versions(4)); // base=4 target=3
    compare.setBase(4);
    compare.setTarget(3);
    // Switching to a different review with only 2 versions: 4 and 3 are gone.
    compare.syncVersions(versions(2));
    expect(store.baseVersion).toBe(2);
    expect(store.targetVersion).toBe(1);
  });

  test("dropping below two versions leaves compare mode", () => {
    const store = makeStore();
    const compare = build(store);
    compare.init(versions(3));
    compare.setComparing(true);
    compare.syncVersions(versions(1));
    expect(store.comparing).toBe(false);
  });

  test("resolving base/target to plan text reads the matching version", () => {
    const store = makeStore();
    const compare = build(store);
    const vs = versions(3);
    compare.init(vs);
    compare.setBase(3);
    compare.setTarget(1);
    expect(compare.planFor(vs, store.baseVersion)).toBe("plan v3");
    expect(compare.planFor(vs, store.targetVersion)).toBe("plan v1");
  });
});

// The cue belongs to the toggle itself, so the header button and the keyboard
// binding cannot drift apart — and only a real flip sounds, the same
// change-guard polling's setConnected carries for the same reason.
describe("sound events (EXC-1126)", () => {
  test("entering compare mode sounds the toggle", () => {
    const compare = build(makeStore());
    compare.setComparing(true);
    expect(sounds).toEqual(["compareToggled"]);
  });

  test("leaving compare mode sounds it again", () => {
    const compare = build(makeStore({ comparing: true }));
    compare.setComparing(false);
    expect(sounds).toEqual(["compareToggled"]);
  });

  test("re-asserting the flag it already holds is silent", () => {
    const compare = build(makeStore());
    compare.setComparing(false);
    compare.setComparing(true);
    compare.setComparing(true);
    expect(sounds).toEqual(["compareToggled"]);
  });

  test("syncVersions dropping compare mode is silent — nobody toggled anything", () => {
    const store = makeStore();
    const compare = build(store);
    compare.init(versions(3));
    compare.setComparing(true);
    sounds.length = 0;
    compare.syncVersions(versions(1));
    expect(store.comparing).toBe(false);
    expect(sounds).toEqual([]);
  });

  test("the dep is optional — a compare with no sound still toggles", () => {
    const store = makeStore();
    createCompare(store, {
      readPref: () => prefValue,
      writePref: (s) => written.push(s),
      readIndicatorsPref: () => indicatorsPrefValue,
      writeIndicatorsPref: (i) => writtenIndicators.push(i),
    }).setComparing(true);
    expect(store.comparing).toBe(true);
  });
});
