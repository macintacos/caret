import { describe, expect, test } from "bun:test";

import { fillFallbackRoles, ROLE_SCOPES } from "@/theme/role-scopes.ts";

describe("ROLE_SCOPES", () => {
  test("gives each scope to one role", () => {
    const scopes = Object.values(ROLE_SCOPES).flat();
    expect(scopes.filter((scope, i) => scopes.indexOf(scope) !== i)).toEqual([]);
  });
});

describe("fillFallbackRoles", () => {
  const fallbacks = { tag: "keyword" } as const;
  const keyword = { color: "#111111", fontStyle: ["bold" as const] };

  test("gives an absent optional role its fallback's style", () => {
    expect(fillFallbackRoles({ keyword }, fallbacks)).toEqual({ keyword, tag: keyword });
  });

  test("keeps a present optional role's own style", () => {
    const tag = { color: "#222222" };
    expect(fillFallbackRoles({ keyword, tag }, fallbacks)).toEqual({ keyword, tag });
  });
});
