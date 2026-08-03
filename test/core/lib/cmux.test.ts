import { expect, test } from "bun:test";

import { readCmuxPane } from "@/lib/cmux.ts";

test("readCmuxPane returns the pane when both ids are set", () => {
  expect(readCmuxPane({ CMUX_WORKSPACE_ID: "w1", CMUX_SURFACE_ID: "s1" })).toEqual({
    workspaceId: "w1",
    surfaceId: "s1",
  });
});

test("readCmuxPane returns undefined when only the workspace id is set", () => {
  expect(readCmuxPane({ CMUX_WORKSPACE_ID: "w1" })).toBeUndefined();
});

test("readCmuxPane returns undefined when only the surface id is set", () => {
  expect(readCmuxPane({ CMUX_SURFACE_ID: "s1" })).toBeUndefined();
});

test("readCmuxPane returns undefined outside cmux (neither id set)", () => {
  expect(readCmuxPane({})).toBeUndefined();
});

test("readCmuxPane treats an empty id as absent", () => {
  expect(readCmuxPane({ CMUX_WORKSPACE_ID: "", CMUX_SURFACE_ID: "s1" })).toBeUndefined();
  expect(readCmuxPane({ CMUX_WORKSPACE_ID: "w1", CMUX_SURFACE_ID: "" })).toBeUndefined();
});
