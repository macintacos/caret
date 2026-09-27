// The npm registry read behind the NpmOps interface, mirroring github.ts: the
// interface lets the release steps be driven by fakes in tests, while createNpm()
// is the real implementation. Publishing itself happens in CI over trusted
// publishing; this side only asks the registry whether a version is live.

export interface NpmOps {
  /** True if the registry serves this package's `version`. */
  isVersionPublished(version: string): Promise<boolean>;
}

/** The package name from the working tree's package.json. */
async function packageName(): Promise<string> {
  const pkg = JSON.parse(await Bun.file("package.json").text()) as { name?: string };
  if (!pkg.name) throw new Error("package.json has no name");
  return pkg.name;
}

/** Constructs the real, registry-backed NpmOps. */
export function createNpm(): NpmOps {
  return {
    async isVersionPublished(version) {
      const url = `https://registry.npmjs.org/${await packageName()}/${version}`;
      const res = await fetch(url);
      if (res.status === 200) return true;
      if (res.status === 404) return false;
      throw new Error(`npm registry answered ${res.status} for ${url}`);
    },
  };
}
