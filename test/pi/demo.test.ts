import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REVIEW_TOOL } from "@bridge/review-bridge.ts";
import { type DemoApi, installDemo } from "@piext/demo.ts";
import { renderPlugin } from "@/adapters/opencode/deploy.ts";

const TEMPLATE = "# A demo plan\n\nSome body.\n";

let tmp: string;
let templatePath: string;

beforeEach(() => {
  tmp = realpathSync.native(mkdtempSync(join(tmpdir(), "caret-demo-")));
  templatePath = join(tmp, "demo.md");
  writeFileSync(templatePath, TEMPLATE);
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function fakePi(path: string, planning = false) {
  const commands: Record<string, (args: string, ctx: unknown) => Promise<void>> = {};
  const sent: { content: string; options: unknown }[] = [];
  const notices: { message: string; type?: string }[] = [];
  let idleAwaited = 0;
  const ctx = {
    ui: { notify: (message: string, type?: string) => notices.push({ message, type }) },
    waitForIdle: async () => {
      idleAwaited++;
    },
    sessionManager: { getSessionId: () => "s" },
  };
  const pi: DemoApi = {
    registerCommand: (name, options) => {
      commands[name] = options.handler as (a: string, c: unknown) => Promise<void>;
    },
    sendUserMessage: (content, options) => sent.push({ content, options }),
  };
  installDemo(pi, { templatePath: path, isPlanning: (id) => planning && id === "s" });
  return {
    sent,
    notices,
    idle: () => idleAwaited,
    command: () => commands["caret:demo"]?.("", ctx),
  };
}

const OPENCODE_COMMAND = join(import.meta.dir, "..", "..", "opencode", "commands", "demo.md");

test("/caret:demo sends OpenCode's rendered /caret:demo body as a follow-up and waits", async () => {
  const pi = fakePi(templatePath);
  await pi.command();
  expect(pi.sent).toHaveLength(1);
  expect(pi.sent[0]?.options).toEqual({ deliverAs: "followUp" });
  const content = pi.sent[0]?.content ?? "";
  const opencode = renderPlugin(readFileSync(OPENCODE_COMMAND, "utf-8"), {
    version: "",
    binPath: "",
    demoTemplate: TEMPLATE,
  });
  expect(opencode.endsWith(content)).toBe(true);
  const frontmatter = opencode.slice(0, opencode.length - content.length);
  expect(frontmatter).toMatch(/^---\n(?:.*\n)*?---\n+$/);
  expect(content).toContain(REVIEW_TOOL);
  expect(pi.idle()).toBe(1);
});

test("/caret:demo refuses with one warning while the session is planning", async () => {
  const pi = fakePi(join(tmp, "absent.md"), true);
  await pi.command();
  expect(pi.notices).toHaveLength(1);
  expect(pi.notices[0]?.type).toBe("warning");
  expect(pi.sent).toEqual([]);
  expect(pi.idle()).toBe(0);
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
