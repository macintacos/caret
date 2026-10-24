// Whether a command's terminal output wears ANSI colour. Pure, so the suite is a table
// over `wantsColor`: a terminal gets colour unless something asked for plain text.

import { expect, test } from "bun:test";

import { wantsColor } from "@/lib/color.ts";

const terminal = { isTTY: true, env: {}, noColorFlag: false };

test("colours a terminal when nothing asks for plain text", () => {
  expect(wantsColor(terminal)).toBe(true);
  expect(wantsColor({ ...terminal, env: { NO_COLOR: "" } })).toBe(true);
});

test("stays plain when the stream is not a terminal", () => {
  expect(wantsColor({ ...terminal, isTTY: false })).toBe(false);
  expect(wantsColor({ ...terminal, isTTY: undefined })).toBe(false);
});

test.each([
  ["NO_COLOR", { env: { NO_COLOR: "1" } }],
  ["TERM=dumb", { env: { TERM: "dumb" } }],
  ["CI=true", { env: { CI: "true" } }],
  ["--no-color", { noColorFlag: true }],
])("stays plain under %s", (_name, override) => {
  expect(wantsColor({ ...terminal, ...override })).toBe(false);
});
