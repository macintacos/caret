import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REVIEW_TOOL } from "@oc/review-bridge.ts";
import { DEMO_INSTRUCTION, type DemoApi, installDemo } from "@piext/demo.ts";

const TEMPLATE = "# A demo plan\n\nSome body.\n";

let tmp: string;
let templatePath: string;

beforeEach(() => {
  tmp = realpathSync.native(mkdtempSync(join(tmpdir(), "caret-demo-")));
  templatePath = join(tmp, "demo.md");
  writeFileSync(templatePath, TEMPLATE);
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function fakePi(path: string) {
  const commands: Record<string, (args: string, ctx: unknown) => Promise<void>> = {};
  const sent: { content: string; options: unknown }[] = [];
  const notices: { message: string; type?: string }[] = [];
  let idleAwaited = 0;
  const ctx = {
    ui: { notify: (message: string, type?: string) => notices.push({ message, type }) },
    waitForIdle: async () => {
      idleAwaited++;
    },
  };
  const pi: DemoApi = {
    registerCommand: (name, options) => {
      commands[name] = options.handler as (a: string, c: unknown) => Promise<void>;
    },
    sendUserMessage: (content, options) => sent.push({ content, options }),
  };
  installDemo(pi, { templatePath: path });
  return {
    sent,
    notices,
    idle: () => idleAwaited,
    command: () => commands["caret:demo"]?.("", ctx),
  };
}

test("/caret:demo sends the instruction then the template as a follow-up and waits", async () => {
  const pi = fakePi(templatePath);
  await pi.command();
  expect(pi.sent).toEqual([
    { content: `${DEMO_INSTRUCTION}\n\n${TEMPLATE}`, options: { deliverAs: "followUp" } },
  ]);
  expect(pi.idle()).toBe(1);
});

test("the demo instruction submits through the review tool without editing files", () => {
  expect(DEMO_INSTRUCTION).toContain(REVIEW_TOOL);
  expect(DEMO_INSTRUCTION).toContain("edit **no** file");
  expect(DEMO_INSTRUCTION).toContain("**Changes requested**");
});

test("an unreadable template is reported once and nothing is sent", async () => {
  const missing = join(tmp, "absent.md");
  const pi = fakePi(missing);
  await pi.command();
  expect(pi.notices).toHaveLength(1);
  expect(pi.notices[0]?.type).toBe("error");
  expect(pi.notices[0]?.message).toContain(missing);
  expect(pi.sent).toEqual([]);
  expect(pi.idle()).toBe(0);
});
