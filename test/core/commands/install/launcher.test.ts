// The launcher installer's contract: the shipped script lands executable at the stable
// path a service unit names, and the `bun` it should prefer is recorded where the script
// looks for it. The source is a fixture, so none of this needs a resolvable caret root.

import { expect, test } from "bun:test";
import {
  chmodSync,
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

import { setupTempStateDir } from "@test/support/env.ts";
import {
  installLauncher,
  isSourceCheckout,
  pruneOwnedRoots,
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
function packageRoot(opts: { ui?: boolean } = {}): { root: string; version: string } {
  const root = mkdtempSync(join(tmpdir(), "caret-pkg-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ version: "1.1.0", files: ["dist/", "ui/dist/", "bin/caret"] }, null, 2),
  );
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "caret"), SCRIPT);
  chmodSync(join(root, "bin", "caret"), 0o755);
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "dist", "cli.js"), "");
  if (opts.ui !== false) {
    mkdirSync(join(root, "ui", "dist"), { recursive: true });
    writeFileSync(join(root, "ui", "dist", "index.html"), "");
  }
  mkdirSync(join(root, "node_modules", "y"), { recursive: true });
  return { root, version: "1.1.0" };
}

/** An owned root the launcher would run, or with `runnable: false` one it would skip. */
function seedOwnedRoot(version: string, runnable = true): string {
  const dir = join(ownedRootsDir(), version);
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "bin", "caret"), SCRIPT);
  chmodSync(join(dir, "bin", "caret"), 0o755);
  if (runnable) {
    mkdirSync(join(dir, "ui", "dist"), { recursive: true });
    writeFileSync(join(dir, "ui", "dist", "index.html"), "");
  }
  return dir;
}

const owned = () => join(ownedRootsDir(), "1.1.0");

test("an install keeps a copy of the published caret's files set under its version", () => {
  const pkg = packageRoot();
  installLauncher({ source: shippedScript, ownedRoot: () => pkg });

  expect(existsSync(join(owned(), "package.json"))).toBe(true);
  expect(perms(join(owned(), "bin", "caret"))).toBe(0o755);
  expect(existsSync(join(owned(), "dist", "cli.js"))).toBe(true);
  expect(existsSync(join(owned(), "ui", "dist", "index.html"))).toBe(true);
  expect(existsSync(join(owned(), "node_modules"))).toBe(false);
  expect(readdirSync(ownedRootsDir())).toEqual(["1.1.0"]);
});

test("the owned copy stays runnable once the install's own root is gone", () => {
  const pkg = packageRoot();
  installLauncher({ source: shippedScript, ownedRoot: () => pkg });
  rmSync(pkg.root, { recursive: true, force: true });

  expect(isRunnableRoot(owned())).toBe(true);
});

test("an install with nothing to stage keeps the owned root an earlier one left", () => {
  installLauncher({ source: shippedScript, ownedRoot: () => packageRoot() });
  installLauncher({ source: shippedScript, ownedRoot: () => undefined });

  expect(isRunnableRoot(owned())).toBe(true);
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

  expect(existsSync(join(owned(), "marker"))).toBe(true);
});

test("a broken owned root of the same version is replaced", () => {
  seedOwnedRoot("1.1.0", false);
  installLauncher({ source: shippedScript, ownedRoot: () => packageRoot() });

  expect(isRunnableRoot(owned())).toBe(true);
});

test("a source the launcher could not run stages nothing", () => {
  installLauncher({ source: shippedScript, ownedRoot: () => packageRoot({ ui: false }) });

  expect(existsSync(ownedRootsDir())).toBe(false);
});

test("pruning keeps only the highest runnable owned root", () => {
  seedOwnedRoot("1.0.2");
  seedOwnedRoot("1.1.0");
  seedOwnedRoot("1.2.0", false);
  mkdirSync(join(ownedRootsDir(), ".1.1.0.9.tmp"));

  pruneOwnedRoots();

  expect(readdirSync(ownedRootsDir())).toEqual(["1.1.0"]);
});

test("pruning with no owned roots is not an error", () => {
  expect(() => pruneOwnedRoots()).not.toThrow();
});

test("a root carrying src/cli.ts is a checkout, never a published caret", () => {
  const { root } = packageRoot();
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "cli.ts"), "");

  expect(isSourceCheckout(root)).toBe(true);
});
