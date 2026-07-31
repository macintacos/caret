// Runtime rumdl acquisition + plan formatting (EXC-828). caret installs the
// pinned `rumdl` binary into its own state dir (off PATH) and shells out
// `rumdl fmt -` to reflow each incoming plan to caret's own 90-col MD013 config
// (not .rumdl.toml's — see RUMDL_CONFIG). Acquisition is version-gated, not
// presence-gated: the binary at caret's path is used only when it reports exactly
// RUMDL_VERSION, so a stale copy left by an older caret is replaced rather than
// reused, and a `rumdl` the machine happens to have on PATH never formats a plan.
// This is the default `doFormat` behind formatPlanMarkdown's
// best-effort envelope (src/plan/markdown.ts): any failure here — unsupported
// platform, offline download, spawn error — throws and is caught there, storing
// the plan raw with one warn, so nothing is ever lost while rumdl is absent.
//
// Acquisition analog: scripts/tasks/release/rumdl.ts (the release-time `rumdl fmt`
// shell-out). This runtime path differs in two ticket-required ways: it invokes a
// downloaded binary by absolute path (end-users have no mise), and it reflows to
// RUMDL_CONFIG's fixed 90-column shape rather than the release module's unbounded
// width.

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ensureStateDir, rumdlBin, rumdlConfig, rumdlDir } from "@/config/paths.ts";

/** The rumdl release pinned for plan formatting — kept in lockstep with
 * mise.lock's `[[tools.rumdl]]` so dev (mise) and prod (this download) agree. */
export const RUMDL_VERSION = "0.2.47";

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
    sha256: "10dc23e994327ecc6e98d285802fcad1174608f203062cb18bac55b51976e0cb",
  },
  "darwin-x64": {
    url: `https://github.com/rvben/rumdl/releases/download/v${RUMDL_VERSION}/rumdl-v${RUMDL_VERSION}-x86_64-apple-darwin.tar.gz`,
    sha256: "9a2bf0c692310e0469fdc66fa83f74579cf0331cc1f9b306b25849cffd146c0f",
  },
  "linux-arm64": {
    url: `https://github.com/rvben/rumdl/releases/download/v${RUMDL_VERSION}/rumdl-v${RUMDL_VERSION}-aarch64-unknown-linux-musl.tar.gz`,
    sha256: "b5ab4207b92c0bf0ea6d8946f15545c787e8cf6ecf2176d9e7f26c43aead86a8",
  },
  "linux-x64": {
    url: `https://github.com/rvben/rumdl/releases/download/v${RUMDL_VERSION}/rumdl-v${RUMDL_VERSION}-x86_64-unknown-linux-musl.tar.gz`,
    sha256: "bd4049763e93d6c25420ec086dee6690af31efc85af463c3ecf5d686a5fcf762",
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

// The formatting-only rumdl config (EXC-828). No [global] lint rules — `rumdl fmt`
// applies fixes and won't fail on leftover lint, so this is formatting-only by
// construction.
//
// It shares .rumdl.toml's 90-column MD013 shape but deliberately diverges on link
// URLs (EXC-931): plans are read in a no-wrap viewer, where a URL nobody can break
// only fragments the sentence around it when it counts against the budget. The
// repo's own markdown is read and edited in a text editor, so .rumdl.toml keeps
// measuring URLs.
//
// The exemption is from *measurement*, so a line carrying a link ends up physically
// wider than 90 by roughly the URL's length — reflow packs prose up to 90 measured
// columns and the URL rides on top. Accepted deliberately: a line that scrolls beats
// a sentence chopped around an isolated link, and the plan reader scrolls rather
// than wraps either way. It also only governs what *causes* a break — a link the
// source already put on its own line stays there.
//
// `ignore-link-urls` already defaults to true but is load-bearing under
// `reflow-length-exemptions`, so it is stated rather than inherited. Inline code
// spans are deliberately NOT exempt (`code-spans` is left at its default): a long
// span still counts against the budget and is isolated onto its own line.
const RUMDL_CONFIG = `[MD013]
line-length = 90
code-blocks = false
tables      = false
reflow      = true
reflow-mode = "normalize"
reflow-length-exemptions = true
ignore-link-urls = true
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

/** Stand the pinned rumdl up at `binPath`, replacing whatever was there.
 * Injected so tests can exercise the resolver offline. */
export type RumdlInstaller = (binPath: string) => Promise<string>;

const installPinnedRumdl: RumdlInstaller = (binPath) => downloadRumdl(binPath, rumdlAsset());

/** The version the binary at `bin` reports (`rumdl --version` prints
 * `rumdl <semver>`), or null when there is nothing runnable there — absent, a
 * truncated download, not executable, or built for another platform. Every one
 * of those means "not the rumdl we pinned", so they collapse to one answer. */
async function installedVersion(bin: string): Promise<string | null> {
  if (!existsSync(bin)) return null;
  try {
    const proc = Bun.spawn([bin, "--version"], { stdout: "pipe", stderr: "ignore" });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) return null;
    return out.trim().split(/\s+/).at(-1) ?? null;
  } catch {
    return null;
  }
}

// Coalesces concurrent installs: the first caller kicks the download off, callers
// arriving while it is in flight await the same promise instead of racing a second
// fetch (they would all still see the old binary, since downloadRumdl only renames
// the new one into place at the end). Cleared once it settles — the binary is on
// disk by then, so the version check below is the gate from that point on, and a
// transient failure (offline, GitHub rate-limit) retries on the next call rather
// than poisoning every later one for the life of the daemon.
let inFlightInstall: Promise<string> | undefined;

/** Ensure rumdl (binary + config) is present under caret's state dir, and is the
 * version caret pinned. Returns the resolved paths plus whether this call
 * installed the binary (`installed`).
 *
 * caret formats every plan with ONE rumdl: `RUMDL_VERSION`, at caret's own path.
 * A binary already sitting there is used only if it reports exactly that version
 * — an older build cached by a previous caret, or a file that won't run, is
 * replaced (downloadRumdl renames the new one over it). A `rumdl` on PATH is
 * never consulted: plan formatting must not vary with whatever the machine
 * happens to have installed. `CARET_RUMDL_BIN` remains the one explicit opt-out,
 * for a caller who is deliberately supplying their own binary.
 *
 * The config is written idempotently on every call so it always tracks the
 * current state dir. */
export async function ensureRumdl(
  install: RumdlInstaller = installPinnedRumdl,
): Promise<{ bin: string; config: string; installed: boolean }> {
  ensureStateDir(rumdlDir());
  const config = rumdlConfig();
  writeFileSync(config, RUMDL_CONFIG);

  const override = process.env.CARET_RUMDL_BIN?.trim();
  if (override) return { bin: override, config, installed: false };

  const bin = rumdlBin();
  if ((await installedVersion(bin)) === RUMDL_VERSION) return { bin, config, installed: false };

  inFlightInstall ??= install(bin).finally(() => {
    inFlightInstall = undefined;
  });
  return { bin: await inFlightInstall, config, installed: true };
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
