// Runtime rumdl acquisition + plan formatting (EXC-828). Covers the three parts
// that carry real logic: the per-platform asset mapping (pinned URL + checksum),
// the download/verify/extract mechanics (offline, via a synthetic archive and an
// injected fetch — the sha256 gate is a trust boundary), and the formatter's
// reflow contract. The formatter tests lean on the CARET_RUMDL_BIN preload
// (test/support/rumdl-preload.ts) so they run against the mise-pinned binary with
// no network.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, statSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { setupTempStateDir } from "@test/support/env.ts";
import { rumdlBin } from "@/config/paths.ts";
import {
  downloadRumdl,
  ensureRumdl,
  RUMDL_VERSION,
  rumdlAsset,
  rumdlFormatPlan,
} from "@/plan/rumdl.ts";

setupTempStateDir("caret-rumdl-");

// The checksums themselves are pinned against mise.lock in
// test/structure/rumdl-pin.test.ts, which compares them to a source they are not
// copied from; asserting them here too would only restate the module constant.
test("rumdlAsset maps each supported platform to its release archive", () => {
  const darwinArm = rumdlAsset("darwin", "arm64");
  expect(darwinArm.url).toBe(
    `https://github.com/rvben/rumdl/releases/download/v${RUMDL_VERSION}/rumdl-v${RUMDL_VERSION}-aarch64-apple-darwin.tar.gz`,
  );

  const linuxX64 = rumdlAsset("linux", "x64");
  expect(linuxX64.url).toContain("x86_64-unknown-linux-musl.tar.gz");
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

// --- Pinned-version enforcement --------------------------------------------
// caret formats plans with ONE rumdl: the pinned release, at caret's own path.
// Anything else living there — an older build a previous caret cached, a file
// that won't run — is replaced rather than reused, so a plan can never be
// reflowed by a version caret didn't choose.

/** Run `fn` with the CARET_RUMDL_BIN override cleared (the test preload sets it
 * for the whole suite, which would short-circuit the resolver under test). */
async function withoutOverride<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.CARET_RUMDL_BIN;
  delete process.env.CARET_RUMDL_BIN;
  try {
    return await fn();
  } finally {
    if (prev !== undefined) process.env.CARET_RUMDL_BIN = prev;
  }
}

/** Run `fn` with the CARET_RUMDL_BIN override pointed at `bin`, restoring
 * whatever the test preload left there. */
async function withOverride<T>(bin: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.CARET_RUMDL_BIN;
  process.env.CARET_RUMDL_BIN = bin;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CARET_RUMDL_BIN;
    else process.env.CARET_RUMDL_BIN = prev;
  }
}

/** An executable stand-in for rumdl that reports `version` the way the real one
 * does (`rumdl <semver>` on stdout). */
async function fakeRumdlAt(path: string, version: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, `#!/bin/sh\necho "rumdl ${version}"\n`);
  chmodSync(path, 0o755);
}

/** An installer that stands the pinned version up at the requested path, and
 * records where it was asked to put it. */
function recordingInstaller(): { calls: string[]; install: (p: string) => Promise<string> } {
  const calls: string[] = [];
  return {
    calls,
    install: async (p) => {
      calls.push(p);
      await fakeRumdlAt(p, RUMDL_VERSION);
      return p;
    },
  };
}

test("ensureRumdl replaces a cached binary that is not the pinned version", async () => {
  await withoutOverride(async () => {
    await fakeRumdlAt(rumdlBin(), "0.2.30");
    const { calls, install } = recordingInstaller();

    const { bin, installed } = await ensureRumdl(install);

    expect(installed).toBe(true);
    expect(calls).toEqual([rumdlBin()]);
    expect(bin).toBe(rumdlBin());
    expect(await Bun.file(bin).text()).toContain(RUMDL_VERSION);
  });
});

test("ensureRumdl reuses the cached binary when it already reports the pinned version", async () => {
  await withoutOverride(async () => {
    await fakeRumdlAt(rumdlBin(), RUMDL_VERSION);

    const { bin, installed } = await ensureRumdl(async () => {
      throw new Error("must not reinstall a binary that is already the pinned version");
    });

    expect(installed).toBe(false);
    expect(bin).toBe(rumdlBin());
  });
});

test("ensureRumdl replaces a cached file that cannot report a version", async () => {
  await withoutOverride(async () => {
    // A truncated download or a non-executable leftover: existsSync says yes,
    // but it is not a rumdl caret can trust.
    mkdirSync(dirname(rumdlBin()), { recursive: true });
    await Bun.write(rumdlBin(), "not a binary");
    const { calls, install } = recordingInstaller();

    const { installed } = await ensureRumdl(install);

    expect(installed).toBe(true);
    expect(calls).toEqual([rumdlBin()]);
  });
});

test("ensureRumdl ignores a rumdl on PATH and installs to caret's own location", async () => {
  await withoutOverride(async () => {
    const shadow = await mkdtemp(join(tmpdir(), "caret-rumdl-path-"));
    await fakeRumdlAt(join(shadow, "rumdl"), "9.9.9");
    const prevPath = process.env.PATH;
    process.env.PATH = `${shadow}:${prevPath}`;
    try {
      await Bun.write(rumdlBin(), "");
      const { calls, install } = recordingInstaller();

      const { bin } = await ensureRumdl(install);

      expect(bin).toBe(rumdlBin());
      expect(calls).toEqual([rumdlBin()]);
    } finally {
      process.env.PATH = prevPath;
    }
  });
});

test("ensureRumdl uses a CARET_RUMDL_BIN that reports the pinned version", async () => {
  const supplied = join(await mkdtemp(join(tmpdir(), "caret-rumdl-override-")), "rumdl");
  await fakeRumdlAt(supplied, RUMDL_VERSION);

  await withOverride(supplied, async () => {
    const { bin, installed } = await ensureRumdl(async () => {
      throw new Error("must not install over an override that is already the pinned version");
    });

    expect(bin).toBe(supplied);
    expect(installed).toBe(false);
  });
});

test("ensureRumdl ignores a CARET_RUMDL_BIN that is not the pinned version", async () => {
  // The override skips the download, not the version thesis (EXC-1053): a binary
  // that reports anything else falls through to caret's own pinned acquisition
  // rather than silently reflowing plans with a version caret didn't choose.
  const stale = join(await mkdtemp(join(tmpdir(), "caret-rumdl-override-")), "rumdl");
  await fakeRumdlAt(stale, "0.2.30");

  await withOverride(stale, async () => {
    const { calls, install } = recordingInstaller();

    const { bin, installed } = await ensureRumdl(install);

    expect(bin).toBe(rumdlBin());
    expect(installed).toBe(true);
    expect(calls).toEqual([rumdlBin()]);
  });
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

test("rumdlFormatPlan does not count a link's URL against the line budget", async () => {
  const url = "https://example.com/search?q=markdown+reflow&sort=relevance&per_page=100";
  const line = `padding padding padding padding [short link](${url}) end.`;
  const out = await rumdlFormatPlan(`intro\n\n${line}\n`);
  expect(out).toContain(line);
});

test("rumdlFormatPlan returns blank input untouched (no subprocess)", async () => {
  expect(await rumdlFormatPlan("")).toBe("");
  expect(await rumdlFormatPlan("   \n  ")).toBe("   \n  ");
});
