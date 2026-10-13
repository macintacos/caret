import { describe, expect, test } from "bun:test";

import { fillFallbackRoles, ROLE_SCOPES } from "@/theme/role-scopes.ts";
import { REQUIRED_SYNTAX_ROLES, type RequiredSyntaxRole, type RoleStyle } from "@/theme/schema.ts";

describe("ROLE_SCOPES", () => {
  test("gives each scope to one role", () => {
    const scopes = Object.values(ROLE_SCOPES).flat();
    expect(scopes.filter((scope, i) => scopes.indexOf(scope) !== i)).toEqual([]);
  });
});

describe("fillFallbackRoles", () => {
  const requiredStyles = Object.fromEntries(
    REQUIRED_SYNTAX_ROLES.map((role, i) => [
      role,
      { color: `#0000${i.toString(16).padStart(2, "0")}` },
    ]),
  ) as Record<RequiredSyntaxRole, RoleStyle>;

  test("gives an absent optional role its fallback's style", () => {
    expect(fillFallbackRoles(requiredStyles).tag).toEqual(requiredStyles.keyword);
  });

  test("keeps a present optional role's own style", () => {
    const tag = { color: "#222222" };
    expect(fillFallbackRoles({ ...requiredStyles, tag }).tag).toEqual(tag);
  });
});
