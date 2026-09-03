import { expect, test } from "bun:test";

import { withEnv } from "./env";

test("a throwing sync fn still restores process.env", () => {
  process.env.CARET_TEST_WITHENV_PROBE = "before";
  expect(() =>
    withEnv({ CARET_TEST_WITHENV_PROBE: "during" }, () => {
      throw new Error("boom");
    }),
  ).toThrow("boom");
  expect(process.env.CARET_TEST_WITHENV_PROBE).toBe("before");
  delete process.env.CARET_TEST_WITHENV_PROBE;
});
