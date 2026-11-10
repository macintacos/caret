// caret's pi install target: plans from caret's entries in pi's settings.json and drives
// pi's package commands through an injected runner, so no case spawns a real `pi` or
// reads the real `~/.pi`.

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PiVersion } from "@/adapters/pi/host.ts";
import { type PiRunner, runInstallPiTarget } from "@/commands/install/pi.ts";
import { recordingUI } from "@/commands/install/ui.ts";

const NPM = "npm:@macintacos/caret";
const OK: PiVersion = { status: "ok", version: "1.5.0" };

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "caret-pi-install-"));
  dirs.push(d);
  return d;
}

function writeManifest(dir: string, name: string, version: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version }));
}

/** A local caret checkout pi can load. */
function checkout(): string {
  const d = tempDir();
  writeManifest(d, "@macintacos/caret", "0.0.0-dev");
  return d;
}

/** A temp agent dir whose settings.json lists `packages`; `npmVersion` places caret in
 * pi's npm root. */
function agentDir(packages: unknown[], npmVersion?: string): string {
  const d = tempDir();
  writeFileSync(join(d, "settings.json"), JSON.stringify({ packages }));
  if (npmVersion) writeManifest(npmCaretDir(d), "@macintacos/caret", npmVersion);
  return d;
}

const npmCaretDir = (agent: string) => join(agent, "npm", "node_modules", "@macintacos", "caret");

/** Records every argv; `update` bumps the installed npm caret to 1.9.0, as pi would. */
function recorder(agent: string, fail?: string[]): { runner: PiRunner; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    runner: async (args) => {
      calls.push(args);
      if (fail && args.join(" ") === fail.join(" ")) return { ok: false, detail: "boom" };
      if (args[0] === "update") writeManifest(npmCaretDir(agent), "@macintacos/caret", "1.9.0");
      return { ok: true, detail: "" };
    },
  };
}

interface Case {
  agent: string;
  uninstall?: boolean;
  dryRun?: boolean;
  repoDir?: string;
  version?: PiVersion;
  fail?: string[];
}

/** Every run goes through here, so pi, its version, and its agent dir are always fakes. */
async function run(c: Case) {
  const { runner, calls } = recorder(c.agent, c.fail);
  const notes: string[] = [];
  const base = recordingUI();
  const ui = {
    ...base,
    note: (body: string, title: string) => {
      notes.push(body);
      base.note(body, title);
    },
  };
  const ok = await runInstallPiTarget(
    {
      uninstall: c.uninstall ?? false,
      dryRun: c.dryRun ?? false,
      local: c.repoDir ? { repoDir: c.repoDir, marketplaceDir: "/unused" } : undefined,
    },
    { pi: runner, piVersion: () => c.version ?? OK, agentDir: c.agent, home: tempDir(), ui },
  );
  return { ok, calls, events: base.events, transcript: base.events.join("\n"), notes };
}

test("a fresh install runs pi install for the npm package", async () => {
  const r = await run({ agent: agentDir([]) });
  expect(r.ok).toBe(true);
  expect(r.calls).toEqual([["install", NPM]]);
});

test("an unpinned npm entry is updated and the version change reported", async () => {
  const r = await run({ agent: agentDir([NPM], "1.8.1") });
  expect(r.calls).toEqual([["update", NPM]]);
  expect(r.transcript).toContain("1.8.1");
  expect(r.transcript).toContain("1.9.0");
});

for (const pinned of [`${NPM}@1.8.1`, `${NPM}@^1.8.0`]) {
  test(`a pinned npm entry (${pinned}) is left alone with the unpin command`, async () => {
    const r = await run({ agent: agentDir([pinned], "1.8.1") });
    expect(r.ok).toBe(true);
    expect(r.calls).toEqual([]);
    expect(r.transcript).toContain(pinned);
    expect(r.transcript).toContain(`pi install ${NPM}`);
  });
}

test("an npm entry pi lists but hasn't unpacked reports the update without a version", async () => {
  const r = await run({ agent: agentDir([NPM]) });
  expect(r.ok).toBe(true);
  expect(r.transcript).toContain("Asked pi for the latest caret");
  expect(r.transcript).not.toContain("null");
});

test("a failing pi update warns and the run carries on", async () => {
  const repo = checkout();
  const r = await run({ agent: agentDir([NPM, repo], "1.8.1"), fail: ["update", NPM] });
  expect(r.ok).toBe(true);
  expect(r.calls).toEqual([
    ["update", NPM],
    ["remove", repo],
  ]);
  expect(r.events.find((e) => e.startsWith("warn:"))).toContain("boom");
  expect(r.transcript).toContain("caret 1.8.1 in pi — the update did not land");
});

test("--from-local installs the checkout before removing the npm entry, and summarises", async () => {
  const repo = checkout();
  const r = await run({ agent: agentDir([NPM], "1.8.1"), repoDir: repo });
  expect(r.calls).toEqual([
    ["install", repo],
    ["remove", NPM],
  ]);
  expect(r.events.some((e) => e.startsWith("settled:") && e.includes(NPM))).toBe(true);
  expect(r.events.some((e) => e.startsWith("info:") && e.includes(NPM))).toBe(true);
});

test("a plain install over a local entry installs npm first, then removes it by its resolved dir", async () => {
  const repo = checkout();
  const r = await run({ agent: agentDir([repo]) });
  expect(r.calls).toEqual([
    ["install", NPM],
    ["remove", repo],
  ]);
});

test("a plain install over npm and local entries updates npm, then removes the local one", async () => {
  const repo = checkout();
  const r = await run({ agent: agentDir([NPM, repo], "1.8.1") });
  expect(r.calls).toEqual([
    ["update", NPM],
    ["remove", repo],
  ]);
});

test("--from-local replaces another checkout's entry", async () => {
  const other = checkout();
  const repo = checkout();
  const r = await run({ agent: agentDir([other]), repoDir: repo });
  expect(r.calls).toEqual([
    ["install", repo],
    ["remove", other],
  ]);
});

test("--from-local over this checkout's own entry only reinstalls it", async () => {
  const repo = checkout();
  const r = await run({ agent: agentDir([repo]), repoDir: repo });
  expect(r.calls).toEqual([["install", repo]]);
});

test("--uninstall removes exactly caret's entries", async () => {
  const repo = checkout();
  const r = await run({
    agent: agentDir([NPM, repo, "npm:some-other-pkg"], "1.8.1"),
    uninstall: true,
  });
  expect(r.ok).toBe(true);
  expect(r.calls).toEqual([
    ["remove", NPM],
    ["remove", repo],
  ]);
});

test("--uninstall attempts every removal even when one fails", async () => {
  const repo = checkout();
  const r = await run({
    agent: agentDir([NPM, repo], "1.8.1"),
    uninstall: true,
    fail: ["remove", NPM],
  });
  expect(r.ok).toBe(true);
  expect(r.calls).toEqual([
    ["remove", NPM],
    ["remove", repo],
  ]);
  expect(r.events.find((e) => e.startsWith("warn:"))).toContain("boom");
});

test("--uninstall with a too-old pi still removes caret's entries", async () => {
  const r = await run({
    agent: agentDir([NPM], "1.8.1"),
    uninstall: true,
    version: { status: "too-old", version: "1.4.9" },
  });
  expect(r.ok).toBe(true);
  expect(r.calls).toEqual([["remove", NPM]]);
});

test("--uninstall without pi on PATH succeeds without running pi", async () => {
  const r = await run({ agent: agentDir([NPM]), uninstall: true, version: { status: "missing" } });
  expect(r.ok).toBe(true);
  expect(r.calls).toEqual([]);
});

test("--uninstall with no caret entry succeeds without running pi", async () => {
  const r = await run({ agent: agentDir([]), uninstall: true });
  expect(r.ok).toBe(true);
  expect(r.calls).toEqual([]);
});

const unusable: [string, PiVersion][] = [
  ["missing", { status: "missing" }],
  ["too-old", { status: "too-old", version: "1.4.9" }],
  ["pre-rename", { status: "pre-rename", version: "0.70.0" }],
];
for (const [name, version] of unusable) {
  test(`install with a ${name} pi stops with guidance naming the package`, async () => {
    const r = await run({ agent: agentDir([]), version });
    expect(r.ok).toBe(false);
    expect(r.calls).toEqual([]);
    const error = r.events.find((e) => e.startsWith("error:")) ?? "";
    expect(error).toContain("@earendil-works/pi-coding-agent");
    if (name === "pre-rename") expect(error).toContain("@mariozechner/pi-coding-agent");
  });
}

test("--dry-run previews the commands without running them", async () => {
  const repo = checkout();
  const r = await run({ agent: agentDir([repo]), dryRun: true });
  expect(r.ok).toBe(true);
  expect(r.calls).toEqual([]);
  expect(r.notes.join("\n")).toContain(`pi remove ${repo}`);
  expect(r.notes.join("\n")).toContain(`pi install ${NPM}`);
});

test("--dry-run lists a pinned entry as left alone", async () => {
  const pinned = `${NPM}@1.8.1`;
  const r = await run({ agent: agentDir([pinned], "1.8.1"), dryRun: true });
  expect(r.calls).toEqual([]);
  expect(r.notes.join("\n")).toContain(`(pinned, left alone) ${pinned}`);
});

test("a failing pi install fails its step and stops the run", async () => {
  const repo = checkout();
  const r = await run({ agent: agentDir([repo]), fail: ["install", NPM] });
  expect(r.ok).toBe(false);
  expect(r.calls).toEqual([["install", NPM]]);
  expect(r.events.find((e) => e.startsWith("error:"))).toContain("boom");
  expect(r.transcript).not.toContain("Removed");
});
