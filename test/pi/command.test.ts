import { expect, test } from "bun:test";

import { caretArgumentCompletions, parseCaretArgs } from "@piext/command.ts";

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

test("an empty prefix offers plan, doctor and demo, each described", () => {
  const items = caretArgumentCompletions("");
  expect(items?.map((item) => item.value)).toEqual(["plan", "doctor", "demo"]);
  expect(items?.every((item) => Boolean(item.description))).toBe(true);
});

test.each([
  ["d", ["doctor", "demo"]],
  ["do", ["doctor"]],
  ["p", ["plan"]],
])("prefix %p offers %p", (prefix, values) => {
  expect(caretArgumentCompletions(prefix)?.map((item) => item.value)).toEqual(values);
});

test.each(["add a greeting", "x", "plan ", "plan add a greeting", "doctor "])(
  "prefix %p offers nothing",
  (prefix) => {
    expect(caretArgumentCompletions(prefix) === null).toBe(true);
  },
);
