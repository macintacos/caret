import { describe, expect, test } from "bun:test";

import { createSettingsDraft, type SettingsDraftStore } from "@/state/settingsDraft.ts";
import type { StagedField } from "$lib/settingsRegistry.ts";

const makeStore = (): SettingsDraftStore => ({ staged: {} });

/** A fake staged field over a local persisted value, recording every hook call —
 * the injected-store discipline: no pref module, no DOM, no mount. */
function makeField<V>(
  key: string,
  initial: V,
  opts: { describe?: (v: V) => string; hooks?: boolean } = {},
) {
  const state = { persisted: initial, staged: [] as V[], reverted: [] as V[] };
  const field: StagedField = {
    kind: "staged",
    key,
    category: "Test",
    label: key,
    description: "",
    control: { kind: "toggle" },
    read: () => state.persisted as unknown,
    write: (v) => {
      state.persisted = v as V;
    },
    describe: opts.describe as ((v: unknown) => string) | undefined,
    onStage: opts.hooks ? (v) => state.staged.push(v as V) : undefined,
    onRevert: opts.hooks ? (v) => state.reverted.push(v as V) : undefined,
  };
  return { field, state };
}

describe("createSettingsDraft — staging & dirty", () => {
  test("stage records a value, marks the field dirty, and surfaces it via value()", () => {
    const { field } = makeField("theme", "dark");
    const store = makeStore();
    const draft = createSettingsDraft(store, [field]);

    draft.stage("theme", "light");

    expect(draft.value("theme")).toBe("light");
    expect(draft.isDirty()).toBe(true);
    expect(draft.dirtyCount()).toBe(1);
  });

  test("value() falls back to the field's persisted value when nothing is staged", () => {
    const { field } = makeField("theme", "dark");
    const draft = createSettingsDraft(makeStore(), [field]);
    expect(draft.value("theme")).toBe("dark");
  });

  test("re-staging the baseline value clears the field's dirty state (value-equality)", () => {
    const { field } = makeField("theme", "dark");
    const draft = createSettingsDraft(makeStore(), [field]);

    draft.stage("theme", "light");
    expect(draft.dirtyCount()).toBe(1);

    draft.stage("theme", "dark"); // back to the original
    expect(draft.isDirty()).toBe(false);
    expect(draft.dirtyCount()).toBe(0);
  });

  test("staging an unknown key is a no-op", () => {
    const draft = createSettingsDraft(makeStore(), []);
    draft.stage("nope", "x");
    expect(draft.isDirty()).toBe(false);
  });
});

describe("createSettingsDraft — changes() preview", () => {
  test("returns each staged field's old → new labels via describe", () => {
    const { field } = makeField("theme", "dark", {
      describe: (v) => (v === "dark" ? "Caret Dark" : "Caret Light"),
    });
    const draft = createSettingsDraft(makeStore(), [field]);

    draft.stage("theme", "light");

    expect(draft.changes()).toEqual([
      { key: "theme", label: "theme", from: "Caret Dark", to: "Caret Light" },
    ]);
  });

  test("falls back to String() when a field has no describe", () => {
    const { field } = makeField("count", 1);
    const draft = createSettingsDraft(makeStore(), [field]);
    draft.stage("count", 2);
    expect(draft.changes()).toEqual([{ key: "count", label: "count", from: "1", to: "2" }]);
  });
});

describe("createSettingsDraft — save", () => {
  test("writes every staged field and clears the draft", () => {
    const a = makeField("a", "a0");
    const b = makeField("b", "b0");
    const draft = createSettingsDraft(makeStore(), [a.field, b.field]);

    draft.stage("a", "a1");
    draft.stage("b", "b1");
    draft.save();

    expect(a.state.persisted).toBe("a1");
    expect(b.state.persisted).toBe("b1");
    expect(draft.isDirty()).toBe(false);
  });

  test("an empty save is a no-op — writes nothing", () => {
    let writes = 0;
    const field: StagedField = {
      kind: "staged",
      key: "a",
      category: "Test",
      label: "a",
      description: "",
      control: { kind: "toggle" },
      read: () => "a0",
      write: () => {
        writes++;
      },
    };
    const draft = createSettingsDraft(makeStore(), [field]);

    draft.save();

    expect(writes).toBe(0);
    expect(draft.isDirty()).toBe(false);
  });
});

describe("createSettingsDraft — hooks", () => {
  test("onStage fires on every stage, including back to baseline", () => {
    const { field, state } = makeField("theme", "dark", { hooks: true });
    const draft = createSettingsDraft(makeStore(), [field]);

    draft.stage("theme", "light");
    draft.stage("theme", "dark");

    expect(state.staged).toEqual(["light", "dark"]);
  });

  test("discard fires onRevert with the baseline for each staged field and clears", () => {
    const { field, state } = makeField("theme", "dark", { hooks: true });
    const draft = createSettingsDraft(makeStore(), [field]);

    draft.stage("theme", "light");
    draft.discard();

    expect(state.reverted).toEqual(["dark"]);
    expect(draft.isDirty()).toBe(false);
    // discard reverts the preview but never persists.
    expect(state.persisted).toBe("dark");
  });
});
