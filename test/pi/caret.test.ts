import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { nodeDetachedSpawn } from "@bridge/review-bridge.ts";
import caret, {
  type CaretHost,
  installCaret,
  meetsFloor,
  PI_FLOOR,
  type PiApi,
} from "@piext/caret.ts";
import { OPEN_KEY } from "@piext/notice.ts";
import { reviewStore } from "@piext/state.ts";
import type { PiTool } from "@piext/tool.ts";
import { until } from "@test/support/poll.ts";
import { stubRunner } from "@test/support/spawn-runner.ts";
import { PI_FLOOR as HOST_FLOOR } from "@/adapters/pi/host.ts";
import { isNewer, parseVersionTriple } from "@/lib/semver.ts";

type Notice = { message: string; type?: string };

function fakePi() {
  const tools: PiTool[] = [];
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const notices: Notice[] = [];
  const commands: Record<string, { handler: (args: string, ctx: unknown) => Promise<void> }> = {};
  const shortcuts: Record<string, { handler: (ctx: unknown) => void }> = {};
  const widgets: { key: string; content: unknown }[] = [];
  const ctx = {
    mode: "tui" as const,
    hasUI: true,
    ui: {
      notify: (message: string, type?: string) => notices.push({ message, type }),
      setWidget: (key: string, content: unknown) => widgets.push({ key, content }),
      setStatus: () => {},
    },
    sessionManager: { getSessionId: () => "s", getBranch: () => [] },
  };
  const pi = {
    registerTool: (tool: PiTool) => tools.push(tool),
    registerCommand: (name: string, options: (typeof commands)[string]) => {
      commands[name] = options;
    },
    registerShortcut: (key: string, options: (typeof shortcuts)[string]) => {
      shortcuts[key] = options;
    },
    appendEntry: () => {},
    registerEntryRenderer: () => {},
    sendUserMessage: () => {},
    on: (event: string, handler: (...args: unknown[]) => void) => {
      const list = handlers[event] ?? [];
      list.push(handler);
      handlers[event] = list;
    },
  } as unknown as PiApi;
  const fire = (event: string) => {
    for (const h of handlers[event] ?? []) h({}, ctx);
  };
  return { pi, tools, commands, shortcuts, widgets, ctx, handlers, notices, fire };
}

const THIS_COPY_URL = "file:///a/pi/caret.ts";
const OTHER_COPY_URL = "file:///b/pi/caret.ts";
const ALLOW = JSON.stringify({ behavior: "allow" });

function host(holder: Record<symbol, unknown>, overrides: Partial<CaretHost> = {}): CaretHost {
  return {
    version: "1.5.1",
    entryUrl: THIS_COPY_URL,
    holder,
    env: {},
    run: stubRunner(ALLOW),
    agentDir: "/tmp/caret-test-agent",
    warm: () => {},
    spawn: () => {},
    stdout: () => {},
    ...overrides,
  };
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

test("registers caret_review_plan", () => {
  const f = fakePi();
  installCaret(f.pi, host({}));
  expect(f.tools.map((t) => t.name)).toEqual(["caret_review_plan"]);
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
  installCaret(second.pi, host(holder, { entryUrl: OTHER_COPY_URL }));
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

test("only the owning copy registers /caret and the open key", () => {
  const holder = {};
  const owner = fakePi();
  installCaret(owner.pi, host(holder));
  const second = fakePi();
  installCaret(second.pi, host(holder, { entryUrl: OTHER_COPY_URL }));
  const old = fakePi();
  installCaret(old.pi, host({}, { version: "1.4.9" }));
  expect(Object.keys(owner.commands)).toEqual(["caret"]);
  expect(Object.keys(owner.shortcuts)).toEqual([OPEN_KEY]);
  expect(Object.keys(second.commands)).toEqual([]);
  expect(Object.keys(second.shortcuts)).toEqual([]);
  expect(Object.keys(old.commands)).toEqual([]);
  expect(Object.keys(old.shortcuts)).toEqual([]);
});

test("/caret completes its subcommands", async () => {
  const f = fakePi();
  installCaret(f.pi, host({}));
  const complete = (f.commands.caret as { getArgumentCompletions?: (prefix: string) => unknown })
    .getArgumentCompletions;
  const items = (await complete?.("")) as { value: string }[] | null | undefined;
  expect(items?.map((item) => item.value)).toEqual(["plan", "doctor", "demo"]);
});

test("a pending review in the tool's store paints the notice", () => {
  const holder = {};
  const f = fakePi();
  installCaret(f.pi, host(holder));
  f.fire("session_start");
  reviewStore(holder).update("s", { pending: "http://caret.localhost/r/1" });
  expect(f.widgets.at(-1)?.key).toBe("caret");
  expect(typeof f.widgets.at(-1)?.content).toBe("function");
});

test("bare /caret notifies a hint naming the open key and opens nothing", async () => {
  const f = fakePi();
  const spawned: string[][] = [];
  installCaret(f.pi, host({}, { spawn: (_bin, args) => spawned.push(args) }));
  await f.commands.caret?.handler("", f.ctx);
  expect(f.notices).toHaveLength(1);
  expect(f.notices[0]?.message).toContain(OPEN_KEY);
  expect(spawned).toEqual([]);
});

test("the open key with a missing caret binary reports an error instead of throwing", async () => {
  const f = fakePi();
  installCaret(
    f.pi,
    host({}, { env: { CARET_PI_BIN: "/nonexistent/caret" }, spawn: nodeDetachedSpawn }),
  );
  f.shortcuts[OPEN_KEY]?.handler(f.ctx);
  expect(await until(() => f.notices.some((n) => n.type === "error"))).toBe(true);
});

test("the owner's session_shutdown frees the slot for another copy", () => {
  const holder = {};
  const first = fakePi();
  installCaret(first.pi, host(holder));
  first.fire("session_shutdown");
  const second = fakePi();
  installCaret(second.pi, host(holder, { entryUrl: OTHER_COPY_URL }));
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

/** Drops what the default export leaves on globalThis, its production holder. */
function releaseGlobalHolder(): void {
  const g = globalThis as Record<symbol, unknown>;
  delete g[Symbol.for("caret.pi.owner")];
  delete g[Symbol.for("caret.pi.reviews.v1")];
  delete g[Symbol.for("caret.pi.notified")];
}

test("the default export registers caret_review_plan", () => {
  const f = fakePi();
  try {
    caret(f.pi);
    expect(f.tools.map((t) => t.name)).toEqual(["caret_review_plan"]);
  } finally {
    releaseGlobalHolder();
  }
});

test("the default export's planning warm runs `caret prewarm` with CARET_AGENT=pi", async () => {
  // The warm stands the daemon up, and the daemon picks its adapter from CARET_AGENT, so
  // a warm without it would serve pi's reviews as a Claude daemon.
  const dir = mkdtempSync(join(tmpdir(), "caret-pi-warm-"));
  const out = join(dir, "argv");
  const shim = join(dir, "shim");
  writeFileSync(shim, `#!/bin/sh\nprintf '%s %s' "$1" "$CARET_AGENT" > ${out}\n`);
  chmodSync(shim, 0o755);
  const priorBin = process.env.CARET_PI_BIN;
  process.env.CARET_PI_BIN = shim;
  const f = fakePi();
  try {
    caret(f.pi);
    reviewStore(globalThis as Record<symbol, unknown>).update("s", { planning: true });
    for (const h of f.handlers.before_agent_start ?? []) h({ messageType: "user" }, f.ctx);
    // The `>` creates the file empty and the lone printf lands in one write, so wait on non-empty.
    expect(await until(() => existsSync(out) && readFileSync(out, "utf-8") !== "")).toBe(true);
    expect(readFileSync(out, "utf-8")).toBe("prewarm pi");
  } finally {
    if (priorBin === undefined) delete process.env.CARET_PI_BIN;
    else process.env.CARET_PI_BIN = priorBin;
    releaseGlobalHolder();
    rmSync(dir, { recursive: true, force: true });
  }
});
