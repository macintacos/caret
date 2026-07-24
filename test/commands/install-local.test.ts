// `caret install --from-local`'s support module: the checkout guard, the generated dev
// marketplace, and the prewarm hand-off. Every effect is injected or aimed at a temp dir,
// so these run without a caret checkout, without `git`, and without spawning the daemon.

import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  devMarketplaceDir,
  prewarmLocalBuild,
  resolveLocalCheckout,
  writeDevMarketplace,
} from "@/commands/install/local.ts";

const temps: string[] = [];

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "caret-local-"));
  temps.push(dir);
  return dir;
}

/** A checkout that satisfies every guard: the marketplace manifest plus the artifacts
 * `mise run build` leaves behind. */
function fullCheckout(): string {
  const root = temp();
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  Bun.write(join(root, ".claude-plugin", "marketplace.json"), "{}");
  mkdirSync(join(root, "bin", "ui"), { recursive: true });
  Bun.write(join(root, "bin", "caret-native"), "#!/bin/sh\n");
  return root;
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("devMarketplaceDir lives under caret's state dir", () => {
  expect(devMarketplaceDir()).toMatch(/caret\/dev-marketplace$/);
});

test("writeDevMarketplace symlinks the checkout and names it the caret marketplace", () => {
  const repo = fullCheckout();
  const out = join(temp(), "dev-marketplace");

  writeDevMarketplace(repo, out);

  // The symlink — not a copy — is what makes every later build install without
  // regenerating the marketplace.
  expect(readlinkSync(join(out, "caret"))).toBe(repo);
  const manifest = JSON.parse(readFileSync(join(out, ".claude-plugin", "marketplace.json"), "utf8"));
  expect(manifest.name).toBe("caret");
  expect(manifest.plugins).toEqual([
    { name: "caret", source: "./caret", description: "Local caret dev build." },
  ]);
});

test("writeDevMarketplace replaces a previous generation rather than merging into it", () => {
  const repo = fullCheckout();
  const out = join(temp(), "dev-marketplace");
  writeDevMarketplace(join(temp(), "stale-checkout"), out);
  Bun.write(join(out, "leftover.txt"), "x");

  writeDevMarketplace(repo, out);

  expect(readlinkSync(join(out, "caret"))).toBe(repo);
  expect(existsSync(join(out, "leftover.txt"))).toBe(false);
});

test("resolveLocalCheckout reports the repo and the ref it describes", () => {
  const repo = fullCheckout();
  const resolved = resolveLocalCheckout({ root: () => repo, describe: () => "v0.7.2-3-gabc1234" });
  expect(resolved).toEqual({ repoDir: repo, ref: "v0.7.2-3-gabc1234" });
});

test("resolveLocalCheckout falls back to an unknown ref when git can't describe", () => {
  const repo = fullCheckout();
  const resolved = resolveLocalCheckout({ root: () => repo, describe: () => null });
  expect(resolved.ref).toBe("unknown ref");
});

test("resolveLocalCheckout rejects a caret that is not a checkout", () => {
  // A published install: no marketplace manifest, so --from-local must not proceed to
  // register a dev marketplace from it.
  const notACheckout = temp();
  expect(() => resolveLocalCheckout({ root: () => notACheckout, describe: () => null })).toThrow(
    /checkout/,
  );
});

test("resolveLocalCheckout rejects a checkout whose build artifacts are missing", () => {
  const repo = temp();
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  Bun.write(join(repo, ".claude-plugin", "marketplace.json"), "{}");

  expect(() => resolveLocalCheckout({ root: () => repo, describe: () => null })).toThrow(
    /mise run build/,
  );
});

test("prewarmLocalBuild runs the built binary's prewarm", async () => {
  const repo = fullCheckout();
  const spawned: string[][] = [];
  await prewarmLocalBuild(repo, {
    spawn: async (cmd) => {
      spawned.push(cmd);
      return 0;
    },
  });
  expect(spawned).toEqual([[join(repo, "bin", "caret-native"), "prewarm"]]);
});

test("prewarmLocalBuild is best-effort: a failing prewarm resolves rather than throwing", async () => {
  const repo = fullCheckout();
  await prewarmLocalBuild(repo, { spawn: async () => 1 });
  await prewarmLocalBuild(repo, {
    spawn: () => Promise.reject(new Error("no such binary")),
  });
});
