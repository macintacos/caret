import { expect, test } from "bun:test";

import { runCommand } from "@/service/run.ts";

test("runCommand returns a non-zero exit rather than rejecting", async () => {
  expect(await runCommand(["sh", "-c", "exit 3"])).toEqual({ code: 3, stdout: "", stderr: "" });
});

test("runCommand captures both streams of the command it ran", async () => {
  const result = await runCommand(["sh", "-c", "printf out; printf err >&2"]);
  expect(result).toEqual({ code: 0, stdout: "out", stderr: "err" });
});
