// Replace a file whole: write a sibling temp, then rename it over the target, so a
// reader sees the old contents or the new, never a torn write. Async only; the sync
// temp-and-rename sites keep their own.

import { realpath, rename, rm, writeFile } from "node:fs/promises";

/** The two filesystem steps, injectable so a test can park between them or fail one. */
export interface AtomicWriteFs {
  writeFile(path: string, data: string, opts: { mode: number }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

/** Write `data` to `path` through a `<target>.<pid>.tmp` sibling, where a symlinked `path`
 * resolves to its target so the link survives. The result takes `mode` even when it
 * replaces a looser file; a failure removes the temp and rethrows. Callers serialize
 * writes to one path (the temp name is per-process), and the `.tmp` suffix keeps a
 * crash's leftover out of a `*.json` scan.
 *
 * ponytail: no fsync, so atomic against readers and a killed process, not a power cut.
 * Fsync the temp and its directory if that ever matters. */
export async function writeFileAtomic(
  path: string,
  data: string,
  opts: { mode: number; fs?: AtomicWriteFs },
): Promise<void> {
  const target = await realpath(path).catch(() => path);
  const tmp = `${target}.${process.pid}.tmp`;
  const fs = opts.fs ?? { writeFile, rename };
  try {
    await fs.writeFile(tmp, data, { mode: opts.mode });
    await fs.rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
