import { describe, expect, test } from "bun:test";
import type { ApproveVariant } from "@core/types";
import { approveLabel, approveVariants, WIRE_FALLBACK } from "./approve.ts";

describe("approveVariants", () => {
  test("returns the declared set when present and non-empty", () => {
    const declared: ApproveVariant[] = [{ id: "approve", label: "Approve" }];
    expect(approveVariants(declared)).toBe(declared);
  });

  test("falls back to the built-in set when the declared list is undefined", () => {
    expect(approveVariants(undefined)).toBe(WIRE_FALLBACK);
  });

  test("falls back to the built-in set when the declared list is empty", () => {
    expect(approveVariants([])).toBe(WIRE_FALLBACK);
  });

  test("the built-in set carries today's three variants in order", () => {
    expect(WIRE_FALLBACK.map((v) => v.id)).toEqual(["default", "acceptEdits", "auto"]);
  });
});

describe("approveLabel", () => {
  test("default id reads 'Approve'", () => {
    expect(approveLabel("default", WIRE_FALLBACK)).toBe("Approve");
  });

  test("acceptEdits id reads 'Approve & accept edits'", () => {
    expect(approveLabel("acceptEdits", WIRE_FALLBACK)).toBe("Approve & accept edits");
  });

  test("auto id reads 'Approve & auto mode' (never a bare 'Approve')", () => {
    expect(approveLabel("auto", WIRE_FALLBACK)).toBe("Approve & auto mode");
  });

  test("an unrecognized id falls back to the first variant's label", () => {
    expect(approveLabel("turbo", WIRE_FALLBACK)).toBe("Approve");
  });

  test("derives the label from the given variant set, not a hard-coded one", () => {
    const variants: ApproveVariant[] = [
      { id: "approve", label: "Ship it" },
      { id: "yolo", label: "Ship it & auto" },
    ];
    expect(approveLabel("yolo", variants)).toBe("Ship it & auto");
    // An unknown id falls back to the first declared variant's label.
    expect(approveLabel("nope", variants)).toBe("Ship it");
  });
});
