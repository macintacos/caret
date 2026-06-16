// Thin `npm`/`mise` shell-outs behind the NpmOps interface, mirroring github.ts:
// the interface lets finalize be driven by fakes in tests, while createNpm() is
// the real implementation. Publishing the run-from-source bundle to npm is what
// makes `/plugin marketplace add macintacos/caret` (the marketplace's npm source)
// resolve a working package (EXC-643). The script never reads or passes tokens —
// it relies on the operator's existing `npm` auth (e.g. ~/.npmrc).

import { $ } from "bun";

export interface NpmOps {
  /** True if this package's `version` is already published to the registry — the
   * resume guard, so a re-run after a partial failure never double-publishes
   * (npm rejects republishing a version, which would otherwise abort finalize). */
  isVersionPublished(version: string): Promise<boolean>;
  /** Build the run-from-source bundle (dist/ + ui/dist) and publish the package.
   * Honors package.json's `publishConfig.access`, so no `--access` flag is
   * needed. finalize only calls this for a real publish — its dry run previews
   * the publish without side effects, like the GitHub-release dry run. */
  publish(): Promise<void>;
}

/** The package name from the working tree's package.json (the publish target). */
async function packageName(): Promise<string> {
  const pkg = JSON.parse(await Bun.file("package.json").text()) as { name?: string };
  if (!pkg.name) throw new Error("package.json has no name");
  return pkg.name;
}

/** Constructs the real, npm-backed NpmOps. */
export function createNpm(): NpmOps {
  return {
    async isVersionPublished(version) {
      const name = await packageName();
      // `npm view <pkg>@<version> version` exits non-zero (E404) when the
      // package or that exact version does not exist on the registry.
      const r = await $`npm view ${`${name}@${version}`} version`.nothrow().quiet();
      return r.exitCode === 0 && r.stdout.toString().trim() !== "";
    },

    async publish() {
      // Build the bundle and the UI it serves so the tarball ships fresh
      // artifacts matching this version, then publish.
      await $`mise run build-bundle`;
      await $`npm publish`;
    },
  };
}
