// The chooser's rows. The multiselect call itself is clack's; what caret owns is which
// rows it offers and how it marks the agents detected on this machine.

import { expect, test } from "bun:test";

import { chooserOptions } from "@/commands/install/prompt.ts";
import { INSTALL_TARGET_IDS } from "@/commands/install/targets.ts";

test("every registry target gets a row, in registry order", () => {
  expect(chooserOptions([]).map((o) => o.value)).toEqual([...INSTALL_TARGET_IDS]);
});

test("a detected agent's row says so; an undetected one's does not", () => {
  const rows = chooserOptions(["claude"]);
  const claude = rows.find((o) => o.value === "claude");
  const opencode = rows.find((o) => o.value === "opencode");
  expect(claude?.hint).toContain("detected");
  expect(opencode?.hint).not.toContain("detected");
});
