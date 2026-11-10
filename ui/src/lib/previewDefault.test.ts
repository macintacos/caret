import "@ui/support/setup.ts";
import { describe, expect, test } from "bun:test";

import { withBlockedStorage } from "@ui/support/storage.ts";
import { applyPreviewDefault } from "$lib/previewDefault.ts";

const MOVED = "caret.previewDefault.moved";
const NOTICE_SEEN = "caret.previewDefault.noticeSeen";
const PLAN_VIEW = "caret.planView";

function storageWith(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
}

describe("applyPreviewDefault", () => {
  test("a new browser is marked moved with the notice already seen, view untouched", () => {
    const s = storageWith({});
    applyPreviewDefault(() => s);
    expect(s.getItem(MOVED)).toBe("1");
    expect(s.getItem(NOTICE_SEEN)).toBe("1");
    expect(s.getItem(PLAN_VIEW)).toBe(null);
  });

  test("a browser holding any caret.* key is moved to preview and owed the notice", () => {
    const s = storageWith({ "caret.lastSeenVersion": "1.0.0" });
    applyPreviewDefault(() => s);
    expect(s.getItem(PLAN_VIEW)).toBe("preview");
    expect(s.getItem(MOVED)).toBe("1");
    expect(s.getItem(NOTICE_SEEN)).toBe(null);
  });

  test("a browser that chose source is moved to preview", () => {
    const s = storageWith({ [PLAN_VIEW]: "source" });
    applyPreviewDefault(() => s);
    expect(s.getItem(PLAN_VIEW)).toBe("preview");
  });

  test("a caret:diffview:* key alone counts as used before", () => {
    const s = storageWith({ "caret:diffview:drag-hint-dismissed": "1" });
    applyPreviewDefault(() => s);
    expect(s.getItem(PLAN_VIEW)).toBe("preview");
    expect(s.getItem(NOTICE_SEEN)).toBe(null);
  });

  test("runs once: a later source choice survives the next call", () => {
    const s = storageWith({ [PLAN_VIEW]: "source" });
    applyPreviewDefault(() => s);
    s.setItem(PLAN_VIEW, "source");
    applyPreviewDefault(() => s);
    expect(s.getItem(PLAN_VIEW)).toBe("source");
  });

  test("a throwing storage is a no-op", () => {
    const boom = (): never => {
      throw new Error("blocked");
    };
    const s = { ...storageWith({}), getItem: boom, setItem: boom, key: boom } as Storage;
    expect(() => applyPreviewDefault(() => s)).not.toThrow();
  });

  test("an unreachable localStorage is a no-op", () => {
    withBlockedStorage(() => {
      expect(() => applyPreviewDefault(() => localStorage)).not.toThrow();
    });
  });
});
