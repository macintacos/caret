// The launcher installer's contract: the shipped script lands executable at the stable
// path a service unit names, and the `bun` it should prefer is recorded where the script
// looks for it. The suite also covers the owned copy of the published caret — staging and
// pruning it — and the candidate list and pick that mirror the launcher's own. Sources are
// fixtures, so none of this needs a resolvable caret root.

import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { manifest, rootAt, runnableRoot } from "@test/support/caret-root.ts";
import { setupTempStateDir, withEnv } from "@test/support/env.ts";
import {
  installLauncher,
  type LauncherCandidate,
  launcherCandidateDirs,
  pickLauncherRoot,
  pruneOwnedRoots,
  publishedRoot,
  uninstallLauncher,
} from "@/commands/install/launcher.ts";
import {
  launcherBunFile,
  launcherPath,
  launcherPinnedRootFile,
  launcherRecordDir,
  launcherServiceFile,
  ownedRootsDir,
  stateDir,
} from "@/config/paths.ts";
import { isRunnableRoot } from "@/daemon/lifecycle.ts";
import { VERSION } from "@/lib/build-id.ts";

const xdgStateHome = setupTempStateDir("caret-launcher-");

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const SCRIPT = '#!/usr/bin/env bash\nexec caret "$@"\n';

/** A stand-in for the shipped bin/caret-launcher, written beside the state dir rather
 * than inside it so it never perturbs an assertion about what the install created. */
function shippedScript(): string {
  const path = join(xdgStateHome(), "caret-launcher");
  writeFileSync(path, SCRIPT);
  return path;
}

function perms(path: string): number {
  return statSync(path).mode & 0o777;
}

test("the launcher lands at the stable path, byte-for-byte and executable", () => {
  installLauncher({ bunPath: "/opt/bun/bin/bun", source: shippedScript });

  expect(readFileSync(launcherPath(), "utf8")).toBe(SCRIPT);
  // The fixture is written 0644, so this fails if the copy doesn't chmod.
  expect(perms(launcherPath())).toBe(0o755);
});

test("the install leaves no temp file beside the launcher it renamed into place", () => {
  installLauncher({ bunPath: "/opt/bun/bin/bun", source: shippedScript });

  expect(existsSync(`${launcherPath()}.${process.pid}.tmp`)).toBe(false);
});

test("bun-path records the given bun, newline-terminated for the launcher's `read -r`", () => {
  installLauncher({ bunPath: "/opt/bun/bin/bun", source: shippedScript });

  expect(readFileSync(launcherBunFile(), "utf8")).toBe("/opt/bun/bin/bun\n");
  expect(perms(launcherBunFile())).toBe(0o600);
});

test("bun-path defaults to the bun running the install", () => {
  // The suite runs under `bun test`, so argv[1] is a .ts entry — never the binary kind
  // that has no bun to record.
  installLauncher({ source: shippedScript });

  expect(readFileSync(launcherBunFile(), "utf8")).toBe(`${process.execPath}\n`);
});

test("both destinations sit under the state dir, which stays 0700", () => {
  installLauncher({ bunPath: "/opt/bun/bin/bun", source: shippedScript });

  expect(launcherPath().startsWith(`${stateDir()}/`)).toBe(true);
  expect(launcherBunFile().startsWith(`${stateDir()}/`)).toBe(true);
  expect(perms(stateDir())).toBe(0o700);
  expect(perms(dirname(launcherPath()))).toBe(0o700);
  expect(perms(launcherRecordDir())).toBe(0o700);
});

test("the service record names the unit, newline-terminated like bun-path", () => {
  installLauncher({
    bunPath: "/opt/bun/bin/bun",
    serviceLabel: "caret.service",
    source: shippedScript,
  });

  expect(readFileSync(launcherServiceFile(), "utf8")).toBe("caret.service\n");
  expect(perms(launcherServiceFile())).toBe(0o600);
});

test("an install naming no unit leaves no service record for the launcher to act on", () => {
  installLauncher({ bunPath: "/opt/bun/bin/bun", source: shippedScript });

  expect(existsSync(launcherServiceFile())).toBe(false);
});

test("pinned-root records the given checkout, newline-terminated like bun-path", () => {
  installLauncher({ bunPath: "/opt/bun/bin/bun", pinnedRoot: "/checkout", source: shippedScript });

  expect(readFileSync(launcherPinnedRootFile(), "utf8")).toBe("/checkout\n");
  expect(perms(launcherPinnedRootFile())).toBe(0o600);
});

test("an install naming no pin removes the pin an earlier install left", () => {
  mkdirSync(launcherRecordDir(), { recursive: true });
  writeFileSync(launcherPinnedRootFile(), "/checkout\n");

  const { unpinned } = installLauncher({ bunPath: "/opt/bun/bin/bun", source: shippedScript });

  expect(existsSync(launcherPinnedRootFile())).toBe(false);
  expect(unpinned).toBe(true);
});

test("an install with no pin to remove, or naming one, reports nothing unpinned", () => {
  expect(installLauncher({ bunPath: "/opt/bun/bin/bun", source: shippedScript }).unpinned).toBe(
    false,
  );
  expect(
    installLauncher({ bunPath: "/opt/bun/bin/bun", pinnedRoot: "/checkout", source: shippedScript })
      .unpinned,
  ).toBe(false);
});

test("uninstallLauncher removes the launcher, its records and the owned roots, leaving the state dir", () => {
  installLauncher({
    bunPath: "/opt/bun/bin/bun",
    serviceLabel: "caret.service",
    pinnedRoot: "/checkout",
    source: shippedScript,
  });
  mkdirSync(join(ownedRootsDir(), "1.1.0"), { recursive: true });

  uninstallLauncher();

  expect(existsSync(launcherPath())).toBe(false);
  expect(existsSync(launcherPinnedRootFile())).toBe(false);
  expect(existsSync(launcherRecordDir())).toBe(false);
  expect(existsSync(ownedRootsDir())).toBe(false);
  expect(existsSync(stateDir())).toBe(true);
});

test("uninstallLauncher on a machine that never had one is not an error", () => {
  expect(() => uninstallLauncher()).not.toThrow();
});

test("the default source names a script this repo actually ships", () => {
  // Every other case injects a fixture, so nothing else would catch the shipped script
  // being renamed out from under the default.
  expect(existsSync(join(REPO_ROOT, "bin", "caret-launcher"))).toBe(true);
});

/** A published caret's package root: the npm `files` set, plus a node_modules the copy
 * must leave behind. */
function packageRoot(opts: { ui?: boolean; files?: string[] } = {}): {
  root: string;
  version: string;
} {
  const files = opts.files ?? ["dist/", "ui/dist/", "bin/caret"];
  const root = runnableRoot(
    mkdtempSync(join(tmpdir(), "caret-pkg-")),
    JSON.stringify({ version: "1.1.0", files }, null, 2),
  );
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "dist", "cli.js"), "");
  if (opts.ui === false) rmSync(join(root, "ui"), { recursive: true });
  mkdirSync(join(root, "node_modules", "y"), { recursive: true });
  return { root, version: "1.1.0" };
}

/** An owned root the launcher would run, or with `runnable: false` one it would skip. */
function seedOwnedRoot(version: string, runnable = true): string {
  const dir = runnableRoot(join(ownedRootsDir(), version), manifest(version));
  if (!runnable) rmSync(join(dir, "ui"), { recursive: true });
  return dir;
}

const stagedRoot = () => join(ownedRootsDir(), "1.1.0");

test("an install keeps a copy of the published caret's files set under its version", () => {
  const pkg = packageRoot();
  installLauncher({ source: shippedScript, ownedRoot: () => pkg });

  expect(existsSync(join(stagedRoot(), "package.json"))).toBe(true);
  expect(perms(join(stagedRoot(), "bin", "caret"))).toBe(0o755);
  expect(existsSync(join(stagedRoot(), "dist", "cli.js"))).toBe(true);
  expect(existsSync(join(stagedRoot(), "ui", "dist", "index.html"))).toBe(true);
  expect(existsSync(join(stagedRoot(), "node_modules"))).toBe(false);
  expect(readdirSync(ownedRootsDir())).toEqual(["1.1.0"]);
});

test("the owned copy stays runnable once the install's own root is gone", () => {
  const pkg = packageRoot();
  installLauncher({ source: shippedScript, ownedRoot: () => pkg });
  rmSync(pkg.root, { recursive: true, force: true });

  expect(isRunnableRoot(stagedRoot())).toBe(true);
});

test("an install with nothing to stage keeps the owned root an earlier one left", () => {
  installLauncher({ source: shippedScript, ownedRoot: () => packageRoot() });
  installLauncher({ source: shippedScript, ownedRoot: () => undefined });

  expect(isRunnableRoot(stagedRoot())).toBe(true);
});

test("a pinned install stages no owned root", () => {
  installLauncher({
    source: shippedScript,
    pinnedRoot: "/checkout",
    ownedRoot: () => packageRoot(),
  });

  expect(existsSync(ownedRootsDir())).toBe(false);
});

test("a runnable owned root of the same version is left as it is", () => {
  writeFileSync(join(seedOwnedRoot("1.1.0"), "marker"), "");
  installLauncher({ source: shippedScript, ownedRoot: () => packageRoot() });

  expect(existsSync(join(stagedRoot(), "marker"))).toBe(true);
});

test("a broken owned root of the same version is replaced", () => {
  seedOwnedRoot("1.1.0", false);
  installLauncher({ source: shippedScript, ownedRoot: () => packageRoot() });

  expect(isRunnableRoot(stagedRoot())).toBe(true);
});

test("a source the launcher could not run stages nothing", () => {
  installLauncher({ source: shippedScript, ownedRoot: () => packageRoot({ ui: false }) });

  expect(existsSync(ownedRootsDir())).toBe(false);
});

test("a copy its files set leaves unrunnable is never staged, and leaves nothing behind", () => {
  installLauncher({ source: shippedScript, ownedRoot: () => packageRoot({ files: ["bin/"] }) });

  expect(existsSync(ownedRootsDir()) ? readdirSync(ownedRootsDir()) : []).toEqual([]);
});

test("pruning keeps only the highest runnable owned root", () => {
  seedOwnedRoot("1.0.2");
  seedOwnedRoot("1.1.0");
  seedOwnedRoot("1.2.0", false);
  mkdirSync(join(ownedRootsDir(), ".1.1.0.9.tmp"));

  pruneOwnedRoots();

  expect(readdirSync(ownedRootsDir())).toEqual(["1.1.0"]);
});

test("pruning keeps the root the launcher picks, not the one its dir name ranks highest", () => {
  seedOwnedRoot("0.15.0");
  seedOwnedRoot("0.15.0-rc.1");
  const picked = pickLauncherRoot(
    null,
    ["0.15.0", "0.15.0-rc.1"].map((v) => mine(join(ownedRootsDir(), v))),
  );

  pruneOwnedRoots();

  expect(readdirSync(ownedRootsDir())).toEqual(["0.15.0-rc.1"]);
  expect(picked?.root).toBe(join(ownedRootsDir(), "0.15.0-rc.1"));
});

test("pruning with no owned roots is not an error", () => {
  expect(() => pruneOwnedRoots()).not.toThrow();
});

test("only a bundle run from a published tarball has a root to keep", () => {
  const { root } = packageRoot();
  const checkout = packageRoot().root;
  mkdirSync(join(checkout, "src"));
  writeFileSync(join(checkout, "src", "cli.ts"), "");

  expect(publishedRoot("bundle", () => root)).toEqual({ root, version: VERSION });
  expect(publishedRoot("bundle", () => checkout)).toBeUndefined();
  expect(publishedRoot("dev", () => root)).toBeUndefined();
  expect(publishedRoot("binary", () => root)).toBeUndefined();
});

const agent = (dir: string): LauncherCandidate => ({ dir, owned: false });
const mine = (dir: string): LauncherCandidate => ({ dir, owned: true });

test("an owned root newer than every agent's is the one the launcher starts", () => {
  const ownedRoot = rootAt("1.1.0");

  expect(pickLauncherRoot(null, [agent(rootAt("1.0.2")), mine(ownedRoot)])).toEqual({
    root: ownedRoot,
    version: "1.1.0",
  });
});

test("an agent's root newer than the owned one is the one the launcher starts", () => {
  const claude = rootAt("1.2.0");

  expect(pickLauncherRoot(null, [agent(claude), mine(rootAt("1.1.0"))])?.root).toBe(claude);
});

test("an agent's root wins a version tie with the owned root", () => {
  // The agent's path sorts first, so only the rank can make it win.
  const base = mkdtempSync(join(tmpdir(), "caret-tie-"));
  const claude = runnableRoot(join(base, "a", "1.1.0"), manifest("1.1.0"));
  const ownedRoot = runnableRoot(join(base, "z", "1.1.0"), manifest("1.1.0"));

  expect(pickLauncherRoot(null, [agent(claude), mine(ownedRoot)])?.root).toBe(claude);
});

test("a runnable pin beats a higher candidate, and a non-runnable pin falls through", () => {
  const pin = rootAt("1.0.0");
  const higher = rootAt("1.2.0");

  expect(pickLauncherRoot(pin, [agent(higher)])).toEqual({ root: pin, version: "1.0.0" });
  expect(pickLauncherRoot("/no/such/root", [agent(higher)])?.root).toBe(higher);
});

test("a root with no UI is never picked", () => {
  const uiless = rootAt("1.2.0");
  rmSync(join(uiless, "ui"), { recursive: true });
  const other = rootAt("1.0.0");

  expect(pickLauncherRoot(null, [agent(uiless), agent(other)])?.root).toBe(other);
});

test("a manifest the launcher's anchored read misses yields no candidate", () => {
  const minified = mkdtempSync(join(tmpdir(), "caret-root-min-"));
  runnableRoot(minified, JSON.stringify({ name: "x", version: "9.0.0" }));
  const empty = mkdtempSync(join(tmpdir(), "caret-root-empty-"));
  runnableRoot(empty, '{\n  "version": "",\n  "x": { "version": "9.0.0" }\n}\n');

  expect(pickLauncherRoot(null, [agent(minified), agent(empty)])).toBeNull();
});

test("nothing runnable leaves the launcher nothing to start", () => {
  expect(pickLauncherRoot(null, [agent("/no/such/root")])).toBeNull();
});

test("a runnable root with no package.json yields no candidate", () => {
  const bare = runnableRoot(mkdtempSync(join(tmpdir(), "caret-root-bare-")), undefined);

  expect(pickLauncherRoot(null, [agent(bare)])).toBeNull();
});

test("the candidates are every agent's caret dir and caret's own copies", () => {
  const claudeDir = mkdtempSync(join(tmpdir(), "caret-claude-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "caret-cache-"));
  const claudeRoots = join(claudeDir, "plugins", "cache", "caret", "caret");
  mkdirSync(join(claudeRoots, "1.0.2"), { recursive: true });
  mkdirSync(join(claudeRoots, ".hidden"), { recursive: true });
  const opencode = join(
    cacheDir,
    "opencode/packages/@macintacos/caret@1.0.2/node_modules/@macintacos/caret",
  );
  mkdirSync(opencode, { recursive: true });
  const ownedRoot = seedOwnedRoot("1.1.0");
  mkdirSync(join(ownedRootsDir(), ".1.2.0.9.tmp"));

  const dirs = withEnv({ CLAUDE_CONFIG_DIR: claudeDir, XDG_CACHE_HOME: cacheDir }, () =>
    launcherCandidateDirs(),
  );

  expect(dirs).toEqual([
    { dir: join(claudeRoots, "1.0.2"), owned: false },
    { dir: opencode, owned: false },
    { dir: ownedRoot, owned: true },
  ]);
});

test("an OpenCode-only machine still offers the owned root", () => {
  const ownedRoot = runnableRoot(join(ownedRootsDir(), "1.1.0"), manifest("1.1.0"));
  const env = {
    CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), "caret-claude-")),
    XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), "caret-cache-")),
  };

  const dirs = withEnv(env, () => launcherCandidateDirs());

  expect(dirs).toEqual([{ dir: ownedRoot, owned: true }]);
  expect(pickLauncherRoot(null, dirs)).toEqual({ root: ownedRoot, version: "1.1.0" });
});
