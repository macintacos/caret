import { expect, test } from "bun:test";

import { compareCodeUnits } from "@/lib/compare.ts";

test("orders by UTF-16 code unit, not locale", () => {
  expect(["b", "é", "B", "a", "e"].sort(compareCodeUnits)).toEqual(["B", "a", "b", "e", "é"]);
});
