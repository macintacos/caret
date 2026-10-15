import { describe, expect, test } from "bun:test";

import { memoLast } from "$lib/memoLast.ts";

function counting(): { compute: (key: string) => { key: string }; calls: () => number } {
  let calls = 0;
  const compute = (key: string) => {
    calls++;
    return { key };
  };
  return { compute, calls: () => calls };
}

describe("memoLast", () => {
  test("computes a repeated key once and returns the same object", () => {
    const fake = counting();
    const memo = memoLast(fake.compute);
    const first = memo("a");
    expect(memo("a") === first).toBe(true);
    expect(fake.calls()).toBe(1);
  });

  test("computes again for a new key", () => {
    const fake = counting();
    const memo = memoLast(fake.compute);
    memo("a");
    memo("b");
    expect(fake.calls()).toBe(2);
  });
});
