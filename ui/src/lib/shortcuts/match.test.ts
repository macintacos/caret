import "@ui/support/setup.ts";
import { describe, expect, test } from "bun:test";

import { chordMatches, matchKeydown } from "$lib/shortcuts/match.ts";
import type { KeySpec, ShortcutEntry } from "$lib/shortcuts/registry.ts";

function kd(
  key: string,
  mods: Partial<Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>> = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, ...mods });
}
function act(id: string, keys: KeySpec): ShortcutEntry {
  return { id, keys, group: "motion", label: id, run: () => {} };
}

describe("chordMatches", () => {
  test("a bare key matches its keydown", () => {
    expect(chordMatches({ key: "j" }, kd("j"))).toBe(true);
    expect(chordMatches({ key: "j" }, kd("k"))).toBe(false);
  });
  test("a bare key does not fire under a command modifier", () => {
    expect(chordMatches({ key: "j" }, kd("j", { metaKey: true }))).toBe(false);
    expect(chordMatches({ key: "j" }, kd("j", { ctrlKey: true }))).toBe(false);
  });
  test("a ctrl chord requires ctrl and rejects meta", () => {
    expect(chordMatches({ key: "d", mods: ["ctrl"] }, kd("d", { ctrlKey: true }))).toBe(true);
    expect(chordMatches({ key: "d", mods: ["ctrl"] }, kd("d"))).toBe(false);
    expect(chordMatches({ key: "d", mods: ["ctrl"] }, kd("d", { metaKey: true }))).toBe(false);
  });
  test("a mod chord matches meta OR ctrl (platform-agnostic)", () => {
    expect(chordMatches({ key: "Enter", mods: ["mod"] }, kd("Enter", { metaKey: true }))).toBe(
      true,
    );
    expect(chordMatches({ key: "Enter", mods: ["mod"] }, kd("Enter", { ctrlKey: true }))).toBe(
      true,
    );
    expect(chordMatches({ key: "Enter", mods: ["mod"] }, kd("Enter"))).toBe(false);
  });
  test("case-sensitive key matches the shifted character", () => {
    expect(chordMatches({ key: "V" }, kd("V"))).toBe(true);
    expect(chordMatches({ key: "v" }, kd("V"))).toBe(false);
  });
});

describe("matchKeydown sequences", () => {
  const gg = act("top", [{ key: "g" }, { key: "g" }]);
  const jump = act("bottom", [{ key: "]" }, { key: "]" }]);
  const single = act("down", [{ key: "j" }]);
  const entries = [gg, jump, single];

  test("a single-chord entry matches immediately", () => {
    const r = matchKeydown(null, kd("j"), entries, 0, 800);
    expect(r.entry?.id).toBe("down");
    expect(r.state).toBeNull();
  });

  test("the first key of a sequence buffers without matching", () => {
    const r = matchKeydown(null, kd("g"), entries, 0, 800);
    expect(r.entry).toBeNull();
    expect(r.state).not.toBeNull();
  });

  test("the second key within the timeout completes the sequence", () => {
    const first = matchKeydown(null, kd("g"), entries, 0, 800);
    const second = matchKeydown(first.state, kd("g"), entries, 100, 800);
    expect(second.entry?.id).toBe("top");
    expect(second.state).toBeNull();
  });

  test("the second key after the timeout does not complete it", () => {
    const first = matchKeydown(null, kd("g"), entries, 0, 800);
    const second = matchKeydown(first.state, kd("g"), entries, 1000, 800);
    expect(second.entry).toBeNull();
    expect(second.state).not.toBeNull(); // "g" re-buffers as a fresh first key
  });

  test("an interrupting key clears the buffer and does not match", () => {
    const first = matchKeydown(null, kd("g"), entries, 0, 800);
    const second = matchKeydown(first.state, kd("x"), entries, 100, 800);
    expect(second.entry).toBeNull();
    expect(second.state).toBeNull();
  });

  test("distinct sequences do not cross-complete", () => {
    const first = matchKeydown(null, kd("g"), entries, 0, 800);
    const second = matchKeydown(first.state, kd("]"), entries, 50, 800);
    expect(second.entry).toBeNull();
  });
});
