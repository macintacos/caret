import { describe, expect, test } from "bun:test";

import caret, {
  type CaretHost,
  installCaret,
  meetsFloor,
  PI_FLOOR,
  type PiApi,
  type PiNotifyContext,
} from "@piext/caret.ts";
import type { PiTool } from "@piext/tool.ts";
import { stubRunner } from "@test/support/spawn-runner.ts";
import { PI_FLOOR as HOST_FLOOR } from "@/adapters/pi/host.ts";
import { isNewer, parseVersionTriple } from "@/lib/semver.ts";

type Notice = { message: string; type?: string };

function fakePi() {
  const tools: PiTool[] = [];
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const notices: Notice[] = [];
  const ctx: PiNotifyContext = {
    ui: { notify: (message, type) => notices.push({ message, type }) },
  };
  const pi = {
    registerTool: (tool: PiTool) => tools.push(tool),
    on: (event: string, handler: (...args: unknown[]) => void) => {
      const list = handlers[event] ?? [];
      list.push(handler);
      handlers[event] = list;
    },
  } as PiApi;
  const fire = (event: string) => {
    for (const h of handlers[event] ?? []) h({}, ctx);
  };
  return { pi, tools, handlers, notices, fire };
}

const A = "file:///a/pi/caret.ts";
const B = "file:///b/pi/caret.ts";
const ALLOW = JSON.stringify({ behavior: "allow" });

function host(holder: Record<symbol, unknown>, over: Partial<CaretHost> = {}): CaretHost {
  return { version: "1.5.1", entryUrl: A, holder, env: {}, run: stubRunner(ALLOW), ...over };
}

test("PI_FLOOR matches the adapter's floor", () => {
  expect(PI_FLOOR).toBe(HOST_FLOOR);
});

describe("meetsFloor", () => {
  test.each(["1.5.0", "1.5.1", "1.10.0", "2.0.0"])("%s meets it", (v) => {
    expect(meetsFloor(v)).toBe(true);
  });
  test.each(["1.4.9", "0.73.1", "garbage"])("%s does not", (v) => {
    expect(meetsFloor(v)).toBe(false);
  });
  test.each([
    "1.5.0",
    "1.5.1",
    "1.10.0",
    "2.0.0",
    "1.4.9",
    "0.73.1",
    "garbage",
    "1.5.0+build.7",
    "v1.5.0",
    "1.5.0 ",
  ])("%p agrees with the adapter's semver", (v) => {
    expect(meetsFloor(v)).toBe(parseVersionTriple(v) !== null && !isNewer(PI_FLOOR, v));
  });
});

test("registers caret_review_plan and a session_shutdown handler", () => {
  const f = fakePi();
  installCaret(f.pi, host({}));
  expect(f.tools.map((t) => t.name)).toEqual(["caret_review_plan"]);
  expect(f.handlers.session_shutdown?.length).toBe(1);
});

test("below the floor: no tool, one warning across session_starts and reloads", () => {
  const holder = {};
  const f = fakePi();
  installCaret(f.pi, host(holder, { version: "1.4.9" }));
  f.fire("session_start");
  f.fire("session_start");
  expect(f.tools).toEqual([]);
  expect(f.notices.length).toBe(1);
  expect(f.notices[0]?.type).toBe("warning");
  expect(f.notices[0]?.message).toContain("1.5.0");
  expect(f.notices[0]?.message).toContain("1.4.9");
  const again = fakePi();
  installCaret(again.pi, host(holder, { version: "1.4.9" }));
  again.fire("session_start");
  expect(again.notices).toEqual([]);
});

test("a second copy stays off and names both paths; the owner can reload", () => {
  const holder = {};
  const first = fakePi();
  installCaret(first.pi, host(holder));
  const second = fakePi();
  installCaret(second.pi, host(holder, { entryUrl: B }));
  second.fire("session_start");
  second.fire("session_start");
  expect(first.tools.length).toBe(1);
  expect(second.tools).toEqual([]);
  expect(second.notices.length).toBe(1);
  expect(second.notices[0]?.message).toContain("/a/pi/caret.ts");
  expect(second.notices[0]?.message).toContain("/b/pi/caret.ts");
  const reload = fakePi();
  installCaret(reload.pi, host(holder));
  expect(reload.tools.length).toBe(1);
});

test("the owner's session_shutdown frees the slot for another copy", () => {
  const holder = {};
  const first = fakePi();
  installCaret(first.pi, host(holder));
  first.fire("session_shutdown");
  const second = fakePi();
  installCaret(second.pi, host(holder, { entryUrl: B }));
  expect(second.tools.length).toBe(1);
});

describe("caret binary", () => {
  async function spawnedArgv0(
    env: Record<string, string | undefined>,
  ): Promise<string | undefined> {
    let argv0: string | undefined;
    const f = fakePi();
    const run = stubRunner(ALLOW, (command) => {
      argv0 = command[0];
    });
    installCaret(f.pi, host({}, { env, run }));
    await f.tools[0]?.execute("id", { plan: "# p" }, undefined, undefined, {
      cwd: "/tmp",
      sessionManager: { getSessionId: () => "s" },
    });
    return argv0;
  }
  test("CARET_PI_BIN overrides it", async () => {
    expect(await spawnedArgv0({ CARET_PI_BIN: "/x/caret" })).toBe("/x/caret");
  });
  test("defaults to bin/caret beside the package", async () => {
    expect(await spawnedArgv0({})).toBe("/a/bin/caret");
  });
});

test("the default export registers caret_review_plan", () => {
  const f = fakePi();
  try {
    caret(f.pi);
    expect(f.tools.map((t) => t.name)).toEqual(["caret_review_plan"]);
  } finally {
    const g = globalThis as Record<symbol, unknown>;
    delete g[Symbol.for("caret.pi.owner")];
    delete g[Symbol.for("caret.pi.reviews.v1")];
    delete g[Symbol.for("caret.pi.notified")];
  }
});
