import { expect, test } from "bun:test";
import { join } from "node:path";

import { piAgentDir } from "@/adapters/pi/paths.ts";

test("piAgentDir honours PI_CODING_AGENT_DIR with pi's tilde expansion", () => {
  const home = "/home/me";
  expect(piAgentDir({}, home)).toBe(join(home, ".pi", "agent"));
  expect(piAgentDir({ PI_CODING_AGENT_DIR: "" }, home)).toBe(join(home, ".pi", "agent"));
  expect(piAgentDir({ PI_CODING_AGENT_DIR: "~" }, home)).toBe(home);
  expect(piAgentDir({ PI_CODING_AGENT_DIR: "~/agents/pi" }, home)).toBe(join(home, "agents/pi"));
  expect(piAgentDir({ PI_CODING_AGENT_DIR: "/abs/dir" }, home)).toBe("/abs/dir");
});
