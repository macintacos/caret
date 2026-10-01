import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, symlinkSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";

import { writeOpencodeShim } from "@test/support/opencode-shim.ts";
import {
  hostCheck,
  hostConfigFilenames,
  loadedConfigFiles,
  type OpencodeHost,
  opencodeBinsOnPath,
  parseOpencodeVersion,
  pluginKeyFor,
  readOpencodeHosts,
  readOpencodeVersion,
  sharedHost,
} from "@/adapters/opencode/host.ts";
import type { VersionTriple } from "@/lib/semver.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-oc-host-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const shim = (body: string) => writeOpencodeShim(dir, body);
const at = (version: VersionTriple | null, bin = "/a/opencode"): OpencodeHost => ({ bin, version });

test("parses v2's prefixed version and v1's bare one", () => {
  expect(parseOpencodeVersion("opencode v2.0.18\n")).toEqual([2, 0, 18]);
  expect(parseOpencodeVersion("1.14.17\n")).toEqual([1, 14, 17]);
});

test("rejects output that is not a version", () => {
  expect(parseOpencodeVersion("")).toBeNull();
  expect(parseOpencodeVersion("error: unknown flag")).toBeNull();
  expect(parseOpencodeVersion("opencode 2.0")).toBeNull();
});

test("reads the version a binary prints", () => {
  expect(readOpencodeVersion({ bin: shim("echo opencode v2.0.18") })).toEqual([2, 0, 18]);
  expect(readOpencodeVersion({ bin: shim("echo 1.18.29") })).toEqual([1, 18, 29]);
});

test("a failing binary reads as unknown", () => {
  expect(readOpencodeVersion({ bin: shim("echo 2.0.18; exit 1") })).toBeNull();
});

test("a hung binary is killed at the bound, even with a grandchild holding stdout", () => {
  const bin = shim("sleep 30; echo 2.0.18");
  const start = performance.now();
  expect(readOpencodeVersion({ bin, timeoutMs: 200 })).toBeNull();
  expect(performance.now() - start).toBeLessThan(1_000);
});

test("v2 loads caret from plugins; v1 and an unknown host from plugin", () => {
  expect(pluginKeyFor([2, 0, 18])).toBe("plugins");
  expect(pluginKeyFor([1, 18, 29])).toBe("plugin");
  expect(pluginKeyFor(null)).toBe("plugin");
});

test("the host check passes when caret sits in the key its host loads", () => {
  expect(hostCheck([at([2, 0, 18])], ["plugins"], []).status).toBe("pass");
  expect(hostCheck([at([1, 18, 29])], ["plugin"], []).status).toBe("pass");
});

test("the host check fails for caret in plugin on v2", () => {
  expect(hostCheck([at([2, 0, 18])], ["plugin"], []).status).toBe("fail");
  expect(hostCheck([at([2, 0, 18])], ["plugin", "plugins"], []).status).toBe("fail");
});

test("the host check fails for caret in plugins on v1, naming the version that starts", () => {
  const check = hostCheck([at([1, 18, 29])], ["plugins"], []);
  expect(check.status).toBe("fail");
  expect(check.detail).toContain("1.18.16");
});

test("the host check fails for a v1 too old to load caret", () => {
  expect(hostCheck([at([1, 3, 3])], ["plugin"], []).status).toBe("fail");
  expect(hostCheck([at([1, 3, 4])], ["plugin"], []).status).toBe("pass");
});

test("the host check joins every fault it finds", () => {
  const check = hostCheck([at([1, 3, 3])], ["plugins"], []);
  expect(check.status).toBe("fail");
  expect(check.detail).toContain("; ");
  expect(check.status === "fail" && check.remedy).toContain("; ");
});

test("the host check is unknown when the version cannot be read", () => {
  expect(hostCheck([at(null)], ["plugin"], []).status).toBe("unknown");
});

test("v1 loads config.json; v2 and an unknown host load only the opencode files", () => {
  expect(hostConfigFilenames([1, 18, 29])).toContain("config.json");
  expect(hostConfigFilenames([2, 0, 18])).toEqual(["opencode.jsonc", "opencode.json"]);
  expect(hostConfigFilenames(null)).toEqual(["opencode.jsonc", "opencode.json"]);
});

test("loadedConfigFiles keeps only the files the host reads", () => {
  const files = ["/c/opencode.jsonc", "/c/config.json"];
  expect(loadedConfigFiles(files, [2, 0, 18])).toEqual(["/c/opencode.jsonc"]);
  expect(loadedConfigFiles(files, [1, 18, 29])).toEqual(files);
});

test("the host check fails for caret in a file the host ignores, naming the file", () => {
  expect(hostCheck([at([2, 0, 18])], ["plugins"], ["/c/config.json"])).toMatchObject({
    status: "fail",
    detail: expect.stringContaining("config.json"),
    remedy: expect.stringContaining("caret install"),
  });
});

test("opencodeBinsOnPath lists every opencode in PATH order", () => {
  const a = writeOpencodeShim(join(dir, "a"), "echo 1.18.29");
  const b = writeOpencodeShim(join(dir, "b"), "echo opencode v2.0.18");
  expect(opencodeBinsOnPath([join(dir, "b"), join(dir, "a")].join(delimiter))).toEqual([b, a]);
});

test("opencodeBinsOnPath skips relative and empty entries", () => {
  const b = writeOpencodeShim(join(dir, "b"), "echo 1.18.29");
  writeOpencodeShim(join(dir, "a"), "echo 1.18.29");
  const path = [relative(process.cwd(), join(dir, "a")), "", join(dir, "b")].join(delimiter);
  expect(opencodeBinsOnPath(path)).toEqual([b]);
});

test("opencodeBinsOnPath lists a binary reached through a symlink once, under its first spelling", () => {
  const a = writeOpencodeShim(join(dir, "a"), "echo 1.18.29");
  mkdirSync(join(dir, "link"));
  const link = join(dir, "link", "opencode");
  symlinkSync(a, link);
  expect(opencodeBinsOnPath([join(dir, "link"), join(dir, "a")].join(delimiter))).toEqual([link]);
});

test("opencodeBinsOnPath skips a missing dir, a non-executable file, and a broken symlink", () => {
  chmodSync(writeOpencodeShim(join(dir, "noexec"), "echo 1.18.29"), 0o644);
  mkdirSync(join(dir, "broken"));
  symlinkSync(join(dir, "nowhere"), join(dir, "broken", "opencode"));
  const good = writeOpencodeShim(join(dir, "good"), "echo 1.18.29");
  const path = ["missing", "noexec", "broken", "good"].map((d) => join(dir, d)).join(delimiter);
  expect(opencodeBinsOnPath(path)).toEqual([good]);
});

test("readOpencodeHosts reads each binary under its own bound, a hung one as unknown", () => {
  const hung = writeOpencodeShim(join(dir, "hung"), "sleep 30; echo 2.0.18");
  const good = writeOpencodeShim(join(dir, "good"), "echo opencode v2.0.18");
  const start = performance.now();
  const hosts = readOpencodeHosts([join(dir, "hung"), join(dir, "good")].join(delimiter), 200);
  expect(performance.now() - start).toBeLessThan(1_000);
  expect(hosts).toEqual([at(null, hung), at([2, 0, 18], good)]);
});

test("sharedHost stands for every host only when all read and share a major", () => {
  expect(sharedHost([at([2, 0, 18]), at([2, 0, 20], "/b/opencode")])).toEqual([2, 0, 18]);
  expect(sharedHost([at([1, 18, 29]), at([1, 3, 4], "/b/opencode")])).toEqual([1, 18, 29]);
  expect(sharedHost([at([1, 18, 15]), at([2, 0, 18], "/b/opencode")])).toBeNull();
  expect(sharedHost([at([2, 0, 18]), at(null, "/b/opencode")])).toBeNull();
  expect(sharedHost([])).toBeNull();
});

const MIXED = [at([1, 18, 15], "/v1/opencode"), at([2, 0, 18], "/v2/opencode")];

test("the host check passes caret in plugin with v1 beside v2, naming both", () => {
  const check = hostCheck(MIXED, ["plugin"], []);
  expect(check.status).toBe("pass");
  expect(check.detail).toContain("/v1/opencode");
  expect(check.detail).toContain("/v2/opencode");
});

test("the host check fails caret in plugins with v1 beside v2", () => {
  expect(hostCheck(MIXED, ["plugins"], []).status).toBe("fail");
});

test("the host check fails caret in plugins when one host can't be read", () => {
  const check = hostCheck([at([2, 0, 18]), at(null, "/x/opencode")], ["plugins"], []);
  expect(check.status).toBe("fail");
  expect(check.detail).toContain("not every `opencode` on PATH reads as v2");
  expect(check.detail).not.toContain("OpenCode v1 never loads");
});

test("the host check is unknown with no host or none readable", () => {
  expect(hostCheck([], ["plugin"], []).status).toBe("unknown");
  expect(hostCheck([at(null), at(null, "/b/opencode")], ["plugin"], []).status).toBe("unknown");
});
