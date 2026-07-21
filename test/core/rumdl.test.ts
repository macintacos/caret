// Runtime rumdl acquisition + plan formatting (EXC-828). Covers the three parts
// that carry real logic: the per-platform asset mapping (pinned URL + checksum),
// the download/verify/extract mechanics (offline, via a synthetic archive and an
// injected fetch — the sha256 gate is a trust boundary), and the formatter's
// reflow contract. The formatter tests lean on the CARET_RUMDL_BIN preload
// (test/support/rumdl-preload.ts) so they run against the mise-pinned binary with
// no network.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { downloadRumdl, RUMDL_VERSION, rumdlAsset, rumdlFormatPlan } from "@/plan/rumdl.ts";

import { setupTempStateDir } from "../support/env.ts";

setupTempStateDir("caret-rumdl-");

test("rumdlAsset maps each supported platform to its pinned asset + checksum", () => {
  const darwinArm = rumdlAsset("darwin", "arm64");
  expect(darwinArm.url).toBe(
    `https://github.com/rvben/rumdl/releases/download/v${RUMDL_VERSION}/rumdl-v${RUMDL_VERSION}-aarch64-apple-darwin.tar.gz`,
  );
  expect(darwinArm.sha256).toBe("b3c24522bae3e929776cdf88d86fc17e7c504042910da9a8a10f03b5c979c73e");

  const linuxX64 = rumdlAsset("linux", "x64");
  expect(linuxX64.url).toContain("x86_64-unknown-linux-musl.tar.gz");
  expect(linuxX64.sha256).toBe("fdde8e73a5f60254c6a2f43a5c444a08850cef3e85f76edfe6b41016984798d3");
});

test("rumdlAsset throws on an unsupported platform", () => {
  expect(() => rumdlAsset("win32", "x64")).toThrow(/unsupported/i);
});

/** Build a gzipped tarball whose sole member is an executable `rumdl` with the
 * given contents — the shape of the real release asset (bare binary at root). */
async function synthTarGz(binContents: string): Promise<ArrayBuffer> {
  const src = await mkdtemp(join(tmpdir(), "caret-rumdl-fix-"));
  await Bun.write(join(src, "rumdl"), binContents);
  const archive = join(src, "asset.tar.gz");
  await Bun.spawn(["tar", "-czf", archive, "-C", src, "rumdl"]).exited;
  return Bun.file(archive).arrayBuffer();
}

/** A fake `fetch` that always resolves the given archive bytes. */
const fakeFetch = (buf: ArrayBuffer) => async () => ({ arrayBuffer: async () => buf });

test("downloadRumdl verifies the checksum, extracts, and makes the binary executable", async () => {
  const buf = await synthTarGz("#!/bin/sh\necho fake-rumdl\n");
  const sha256 = createHash("sha256").update(new Uint8Array(buf)).digest("hex");
  const dest = join(await mkdtemp(join(tmpdir(), "caret-rumdl-dest-")), "rumdl");

  const out = await downloadRumdl(
    dest,
    { url: "https://example/asset.tar.gz", sha256 },
    fakeFetch(buf),
  );

  expect(out).toBe(dest);
  expect(await Bun.file(dest).text()).toBe("#!/bin/sh\necho fake-rumdl\n");
  // Owner-executable bit set (chmod 0o755).
  expect(statSync(dest).mode & 0o100).toBe(0o100);
});

test("downloadRumdl rejects a checksum mismatch without writing the binary", async () => {
  const buf = await synthTarGz("whatever\n");
  const dest = join(await mkdtemp(join(tmpdir(), "caret-rumdl-bad-")), "rumdl");

  await expect(
    downloadRumdl(
      dest,
      { url: "https://example/asset.tar.gz", sha256: "0".repeat(64) },
      fakeFetch(buf),
    ),
  ).rejects.toThrow(/checksum/i);
  expect(existsSync(dest)).toBe(false);
});

test("rumdlFormatPlan reflows prose to at most 90 columns", async () => {
  const long = `# T\n\n${"word ".repeat(60).trim()}\n`;
  const out = await rumdlFormatPlan(long);
  const lines = out.split("\n");
  expect(lines.length).toBeGreaterThan(3);
  for (const line of lines) expect(line.length).toBeLessThanOrEqual(90);
});

test("rumdlFormatPlan preserves fenced code verbatim", async () => {
  const fence =
    "```text\n" +
    "a deliberately very long line of ASCII that must never be wrapped because fence content is not prose at all\n" +
    "```";
  const out = await rumdlFormatPlan(`intro\n\n${fence}\n`);
  expect(out).toContain(fence);
});

test("rumdlFormatPlan returns blank input untouched (no subprocess)", async () => {
  expect(await rumdlFormatPlan("")).toBe("");
  expect(await rumdlFormatPlan("   \n  ")).toBe("   \n  ");
});
