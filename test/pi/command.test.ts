import { expect, test } from "bun:test";

import { parseCaretArgs } from "@piext/command.ts";

test.each([
  ["", { kind: "usage" }],
  ["   ", { kind: "usage" }],
  ["plan", { kind: "bare-plan" }],
  ["  plan  ", { kind: "bare-plan" }],
  ["doctor", { kind: "doctor" }],
  [" doctor ", { kind: "doctor" }],
  ["demo", { kind: "demo" }],
  ["doctor the flaky login test", { kind: "plan", task: "doctor the flaky login test" }],
  ["plan doctor", { kind: "plan", task: "doctor" }],
  ["planning the migration", { kind: "plan", task: "planning the migration" }],
  ["add a greeting", { kind: "plan", task: "add a greeting" }],
])("parseCaretArgs(%p)", (args, expected) => {
  expect(parseCaretArgs(args)).toEqual(expected as ReturnType<typeof parseCaretArgs>);
});
