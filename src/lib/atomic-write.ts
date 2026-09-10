import { rename, rm, writeFile } from "node:fs/promises";

export interface AtomicWriteFs {
  writeFile(path: string, data: string, opts: { mode: number }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

/** Readers see the old file or the new one, never a torn one. Callers serialize writes
 * to one path: the temp name is per-process. */
export async function writeFileAtomic(
  path: string,
  data: string,
  opts: { mode: number; fs?: AtomicWriteFs },
): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  const fs = opts.fs ?? { writeFile, rename };
  try {
    await fs.writeFile(tmp, data, { mode: opts.mode });
    await fs.rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
