// Runtime rumdl acquisition + plan formatting (EXC-828). caret downloads the
// pinned `rumdl` binary into its own state dir (off PATH) on first use and shells
// out `rumdl fmt -` to reflow each incoming plan to the repo's 90-col MD013
// convention. This is the default `doFormat` behind formatPlanMarkdown's
// best-effort envelope (src/plan/markdown.ts): any failure here — unsupported
// platform, offline download, spawn error — throws and is caught there, storing
// the plan raw with one warn, so nothing is ever lost while rumdl is absent.
//
// Acquisition analog: scripts/tasks/release/rumdl.ts (the release-time `rumdl fmt`
// shell-out). This runtime path differs in two ticket-required ways: it invokes a
// downloaded binary by absolute path (end-users have no mise), and it reflows to
// the ticket's fixed MD013 config (line 90, reflow normalize) rather than the
// release module's unbounded width.

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ensureStateDir, rumdlBin, rumdlConfig, rumdlDir } from "@/config/paths.ts";

/** The rumdl release pinned for plan formatting — kept in lockstep with
 * mise.lock's `[[tools.rumdl]]` so dev (mise) and prod (this download) agree. */
export const RUMDL_VERSION = "0.2.37";

export interface RumdlAsset {
  /** GitHub release download URL for this platform's archive. */
  url: string;
  /** Expected sha256 of the archive bytes (hex), mirrored from mise.lock. */
  sha256: string;
}

/** The slice of `fetch` downloadRumdl needs — narrowed so tests can inject a
 * fake without reconstructing the whole `typeof fetch` surface. `fetch` itself
 * satisfies it. */
type FetchLike = (url: string) => Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;

// Per-platform release assets, mirrored verbatim from mise.lock, keyed by
// `${process.platform}-${process.arch}`. Windows is intentionally omitted:
// caret's installer is bash and its runtime targets are darwin + linux — a win32
// caller throws (rumdlAsset) and falls into the plan-format store-raw envelope.
const ASSETS: Record<string, RumdlAsset> = {
  "darwin-arm64": {
    url: `https://github.com/rvben/rumdl/releases/download/v${RUMDL_VERSION}/rumdl-v${RUMDL_VERSION}-aarch64-apple-darwin.tar.gz`,
    sha256: "ac5f31077c492c3303d27264d8d8840b1279cb5a8cd62f863a2045e1427a6c79",
  },
  "darwin-x64": {
    url: `https://github.com/rvben/rumdl/releases/download/v${RUMDL_VERSION}/rumdl-v${RUMDL_VERSION}-x86_64-apple-darwin.tar.gz`,
    sha256: "7cdfbc6ac896bfe433938a050e0f7b4dfc9ebc78d17ec8f4f872580b1fe06eba",
  },
  "linux-arm64": {
    url: `https://github.com/rvben/rumdl/releases/download/v${RUMDL_VERSION}/rumdl-v${RUMDL_VERSION}-aarch64-unknown-linux-musl.tar.gz`,
    sha256: "2cee94dbc4e577c54869723245be548589e80a5e5a93fe25a3cc535d51e1ac6d",
  },
  "linux-x64": {
    url: `https://github.com/rvben/rumdl/releases/download/v${RUMDL_VERSION}/rumdl-v${RUMDL_VERSION}-x86_64-unknown-linux-musl.tar.gz`,
    sha256: "0999d31c6f1429f0b3b5ed86d3ebb2768e5b4a16b373a51a41a7af2d7eb43b7c",
  },
};

/** Resolve the pinned release asset for a platform/arch (defaults to the current
 * process). Throws descriptively on anything not in the map (e.g. win32); the
 * throw is caught by the plan-format envelope, which stores the plan raw. */
export function rumdlAsset(
  platform: string = process.platform,
  arch: string = process.arch,
): RumdlAsset {
  const asset = ASSETS[`${platform}-${arch}`];
  if (!asset) {
    throw new Error(
      `rumdl: unsupported platform ${platform}-${arch} (darwin/linux, arm64/x64 only)`,
    );
  }
  return asset;
}

// The formatting-only rumdl config (EXC-828): the .rumdl.toml MD013 block,
// verbatim from the ticket. No [global] lint rules — `rumdl fmt` applies fixes and
// won't fail on leftover lint, so this is formatting-only by construction.
const RUMDL_CONFIG = `[MD013]
line-length = 90
code-blocks = false
tables      = false
reflow      = true
reflow-mode = "normalize"
`;

/** Download `asset.url` (via injectable `fetchImpl`), verify its sha256, extract
 * the `rumdl` binary from the tarball, chmod it executable, and move it to
 * `binPath`. Returns `binPath`. The checksum gate is a trust boundary: a mismatch
 * throws before anything lands at `binPath`. */
export async function downloadRumdl(
  binPath: string,
  asset: RumdlAsset,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const res = await fetchImpl(asset.url);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== asset.sha256) {
    throw new Error(
      `rumdl: checksum mismatch for ${asset.url} (expected ${asset.sha256}, got ${actual})`,
    );
  }
  const work = await mkdtemp(join(tmpdir(), "caret-rumdl-"));
  try {
    const archive = join(work, "rumdl.tar.gz");
    await Bun.write(archive, bytes);
    const tar = Bun.spawn(["tar", "-xzf", archive, "-C", work], { stderr: "pipe" });
    if ((await tar.exited) !== 0) throw new Error(`rumdl: failed to extract ${asset.url}`);
    const extracted = join(work, "rumdl");
    if (!existsSync(extracted)) throw new Error(`rumdl: binary not found in ${asset.url}`);
    // Land atomically: copy + chmod a sibling temp file in the destination dir,
    // then rename into place. A hard kill mid-copy leaves the .tmp, never a
    // truncated `binPath` that existsSync() would wrongly treat as a good cache.
    mkdirSync(dirname(binPath), { recursive: true });
    const tmp = `${binPath}.${process.pid}.tmp`;
    await Bun.write(tmp, Bun.file(extracted));
    chmodSync(tmp, 0o755);
    renameSync(tmp, binPath);
    return binPath;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// Guards concurrent first-format downloads: the first caller kicks off the
// download, later callers await the same promise instead of racing a second
// fetch. Only reached in production (no CARET_RUMDL_BIN override, no cached
// binary); tests set the override and never enter this path.
let downloadOnce: Promise<string> | undefined;

/** Ensure rumdl (binary + config) exists under caret's state dir. Returns the
 * resolved paths plus whether this call performed the download (`installed`).
 * Resolution order: `CARET_RUMDL_BIN` override (blank counts as unset) → cached
 * download → fresh download of the pinned asset. The config is written
 * idempotently on every call so it always tracks the current state dir. */
export async function ensureRumdl(): Promise<{ bin: string; config: string; installed: boolean }> {
  ensureStateDir(rumdlDir());
  const config = rumdlConfig();
  writeFileSync(config, RUMDL_CONFIG);

  const override = process.env.CARET_RUMDL_BIN?.trim();
  if (override) return { bin: override, config, installed: false };

  const cached = rumdlBin();
  if (existsSync(cached)) return { bin: cached, config, installed: false };

  // Reset the memo on rejection so a transient failure (offline, GitHub
  // rate-limit) retries on the next format rather than poisoning every later
  // call with the same rejected promise for the life of the daemon.
  downloadOnce ??= downloadRumdl(cached, rumdlAsset()).catch((err) => {
    downloadOnce = undefined;
    throw err;
  });
  return { bin: await downloadOnce, config, installed: true };
}

/** The default `doFormat` for formatPlanMarkdown: reflow `text` through rumdl's
 * formatting-only config. Blank input is returned untouched (no subprocess),
 * mirroring scripts/tasks/release/rumdl.ts. Throws on any spawn/exit failure — the
 * plan-format envelope catches it and stores the plan raw. */
export async function rumdlFormatPlan(text: string): Promise<string> {
  if (text.trim() === "") return text;
  const { bin, config } = await ensureRumdl();
  const proc = Bun.spawn([bin, "fmt", "-", "--config", config], {
    stdin: Buffer.from(text),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) {
    const err = (await new Response(proc.stderr).text()).split("\n", 1)[0] ?? "";
    throw new Error(`rumdl fmt exited ${code}: ${err}`);
  }
  return out;
}
