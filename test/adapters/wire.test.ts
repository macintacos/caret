import { describe, expect, test } from "bun:test";

import { flatDecision } from "@/adapters/wire.ts";

describe("flatDecision", () => {
  test("renders an allow with its notes and a declared accept mode", () => {
    expect(
      flatDecision({ behavior: "allow", feedback: " ok ", acceptMode: "auto" }, ["auto"]),
    ).toEqual({ behavior: "allow", feedback: "ok", acceptMode: "auto" });
  });

  test("fails safe to a deny on a behavior outside the union", () => {
    for (const decision of [{ behavior: "expired" }, {}] as never[]) {
      expect(flatDecision(decision).behavior).toBe("deny");
    }
  });
});
