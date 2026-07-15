import { describe, expect, test } from "bun:test";

import { cn } from "$lib/utils.ts";

describe("cn", () => {
  test("joins truthy class values, drops falsy ones", () => {
    expect(cn("a", false && "b", null, undefined, "c")).toBe("a c");
  });

  test("resolves conflicting Tailwind utilities — last wins (tailwind-merge)", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
  });

  test("keeps non-conflicting utilities from both inputs", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });
});
