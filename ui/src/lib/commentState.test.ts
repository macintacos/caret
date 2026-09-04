import { describe, expect, test } from "bun:test";

import { isUnresolved, type ReviewStatus } from "@core/lib/types";
import { commentState } from "$lib/commentState.ts";

describe("commentState", () => {
  test("absent state reads as a pending draft", () => {
    const v = commentState(undefined);
    expect(v.status).toBe("pending");
    expect(v.label).toBe("Draft");
    expect(v.tone).toBe("draft");
    expect(v.unresolved).toBe(true);
  });

  test("pending is the unsubmitted draft affordance", () => {
    const v = commentState("pending");
    expect(v.label).toBe("Draft");
    expect(v.tone).toBe("draft");
    expect(v.unresolved).toBe(true);
  });

  test("rejected reads as a still-active changes-requested comment", () => {
    const v = commentState("rejected");
    expect(v.label).toBe("Requested");
    expect(v.tone).toBe("draft");
    expect(v.unresolved).toBe(true);
  });

  test("approved is a quiet accepted terminal", () => {
    const v = commentState("approved");
    expect(v.label).toBe("Accepted");
    expect(v.tone).toBe("accepted");
    expect(v.unresolved).toBe(false);
  });

  test("expired is a quiet neutral terminal", () => {
    const v = commentState("expired");
    expect(v.label).toBe("Expired");
    expect(v.tone).toBe("expired");
    expect(v.unresolved).toBe(false);
  });

  test("unresolved mirrors the core isUnresolved over the full vocabulary", () => {
    const all: ReviewStatus[] = ["pending", "approved", "rejected", "expired"];
    for (const s of all) {
      expect(commentState(s).unresolved).toBe(isUnresolved(s));
    }
  });
});
