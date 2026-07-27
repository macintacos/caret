// The install reporter's contract. The clack rendering itself isn't asserted here —
// what matters to callers is that a step runs its work, hands back the value, and
// settles the right way on success and on failure.

import { expect, test } from "bun:test";

import {
  createInstallUI,
  type InstallUI,
  isTerminal,
  recordingUI,
  silentUI,
} from "@/commands/install/ui.ts";

test("a step runs its work and returns the value", async () => {
  const ui: InstallUI = silentUI;
  const got = await ui.step(
    "Doing the thing",
    async () => 42,
    () => "done",
  );
  expect(got).toBe(42);
});

test("the recorder captures each step's label and how it settled", async () => {
  const ui = recordingUI();
  await ui.step(
    "Registering",
    async () => ["a"],
    (v) => `Registered ${v.length}`,
  );
  expect(ui.events).toEqual(["step:Registering", "settled:Registered 1"]);
});

test("a throwing step settles as failed and rethrows to the caller", async () => {
  const ui = recordingUI();
  const boom = ui.step("Installing", async () => {
    throw new Error("claude exited 1");
  });
  await expect(boom).rejects.toThrow("claude exited 1");
  expect(ui.events).toEqual(["step:Installing", "failed:Installing"]);
});

test("off a terminal the reporter emits plain lines — no escape codes", async () => {
  const lines: string[] = [];
  const ui = await createInstallUI({ interactive: false, write: (s) => void lines.push(s) });
  ui.intro("install");
  await ui.step(
    "Installing",
    async () => 3,
    (n) => `Installed ${n} files`,
  );
  ui.warn("slow");
  ui.outro("done");
  // No color codes and no cursor hide/show — the whole point of the plain reporter.
  expect(lines.join("")).not.toContain("\u001b");
  expect(lines.join("")).toContain("Installed 3 files");
  expect(lines.every((l) => l.startsWith("caret:"))).toBe(true);
});

test("off a terminal a failed step still reports, and the error reaches the caller", async () => {
  const lines: string[] = [];
  const ui = await createInstallUI({ interactive: false, write: (s) => void lines.push(s) });
  await expect(
    ui.step("Installing", async () => {
      throw new Error("nope");
    }),
  ).rejects.toThrow("nope");
  expect(lines.join("")).toContain("Installing");
});

test("a run counts as interactive only when BOTH ends are a terminal", () => {
  // A piped stdout would render a prompt's UI into the pipe and read as a hang, so
  // stdout alone is not enough — and neither is stdin alone.
  const saved = { in: process.stdin.isTTY, out: process.stdout.isTTY };
  try {
    for (const [stdin, stdout, expected] of [
      [true, true, true],
      [true, false, false],
      [false, true, false],
      [undefined, undefined, false],
    ] as const) {
      process.stdin.isTTY = stdin as boolean;
      process.stdout.isTTY = stdout as boolean;
      expect(isTerminal()).toBe(expected);
    }
  } finally {
    process.stdin.isTTY = saved.in;
    process.stdout.isTTY = saved.out;
  }
});

test("the recorder captures the non-step surfaces too", () => {
  const ui = recordingUI();
  ui.intro("install");
  ui.note("line one", "Dry run");
  ui.warn("heads up");
  ui.error("broke");
  ui.cancel("cancelled");
  ui.outro("all set");
  expect(ui.events).toEqual([
    "intro:install",
    "note:Dry run",
    "warn:heads up",
    "error:broke",
    "cancel:cancelled",
    "outro:all set",
  ]);
});
