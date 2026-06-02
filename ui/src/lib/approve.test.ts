import { describe, expect, test } from "bun:test";
import type { AcceptMode } from "./types.ts";
import { approveLabel } from "./approve.ts";

describe("approveLabel", () => {
  test("default mode reads 'Approve'", () => {
    expect(approveLabel("default")).toBe("Approve");
  });

  test("acceptEdits mode reads 'Approve & accept edits'", () => {
    expect(approveLabel("acceptEdits")).toBe("Approve & accept edits");
  });

  test("auto mode reads 'Approve & auto mode' (never a bare 'Approve')", () => {
    expect(approveLabel("auto")).toBe("Approve & auto mode");
  });

  test("an unrecognized mode falls back to 'Approve'", () => {
    expect(approveLabel("turbo" as AcceptMode)).toBe("Approve");
  });
});
