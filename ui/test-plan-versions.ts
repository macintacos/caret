import type { PlanVersion } from "@core/lib/types";

/** n versions numbered 1..n; plan text encodes the number for assertions. */
export function versions(n: number): PlanVersion[] {
  return Array.from({ length: n }, (_, i) => ({
    version: i + 1,
    plan: `plan v${i + 1}`,
    annotations: [],
    createdAt: i,
  }));
}
