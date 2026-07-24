// The install-target registry: which agents caret can install into, and how each one
// is detected on this machine. Detection runs against injected probes, so no test
// touches the real PATH or config dirs.

import { expect, test } from "bun:test";

import { opencodeConfigDir } from "@/adapters/opencode/paths.ts";
import {
  type DetectProbe,
  detectTargets,
  INSTALL_TARGET_IDS,
  INSTALL_TARGETS,
} from "@/commands/install-targets.ts";

/** A probe that finds only the named commands and only the named paths. */
function probe(commands: string[] = [], paths: string[] = []): DetectProbe {
  return { hasCommand: (n) => commands.includes(n), hasPath: (p) => paths.includes(p) };
}

test("the registry covers every known target id, in order, with chooser copy", () => {
  expect(INSTALL_TARGETS.map((t) => t.id)).toEqual([...INSTALL_TARGET_IDS]);
  for (const t of INSTALL_TARGETS) {
    expect(t.label.length).toBeGreaterThan(0);
    expect(t.hint.length).toBeGreaterThan(0);
  }
});

test("detectTargets finds Claude Code from the `claude` command", () => {
  expect(detectTargets(probe(["claude"]))).toEqual(["claude"]);
});

test("detectTargets finds OpenCode from the `opencode` command", () => {
  expect(detectTargets(probe(["opencode"]))).toEqual(["opencode"]);
});

test("detectTargets finds OpenCode from an existing config dir with no command", () => {
  expect(detectTargets(probe([], [opencodeConfigDir()]))).toEqual(["opencode"]);
});

test("detectTargets reports both agents in registry order", () => {
  expect(detectTargets(probe(["opencode", "claude"]))).toEqual([...INSTALL_TARGET_IDS]);
});

test("detectTargets reports nothing when neither agent is present", () => {
  expect(detectTargets(probe())).toEqual([]);
});
