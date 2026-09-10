import { afterEach, beforeEach, expect, test } from "bun:test";
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { chmod, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/atomic-write.ts";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-atomic-write-"));
  path = join(dir, "file.json");
  await writeFile(path, "old");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const temps = () => readdirSync(dir).filter((f) => f.endsWith(".tmp"));
const modeOf = (p: string) => statSync(p).mode & 0o777;

test("a reader mid-write sees the old file, then the new one", async () => {
  let parked!: () => void;
  const written = new Promise<void>((r) => {
    parked = r;
  });
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const done = writeFileAtomic(path, "new", {
    mode: 0o600,
    fs: {
      writeFile: async (p, data, opts) => {
        await writeFile(p, data, opts);
        parked();
        await gate;
      },
      rename,
    },
  });
  await written;
  expect(readFileSync(path, "utf-8")).toBe("old");
  const [temp] = temps();
  expect(temp).toBeDefined();
  expect(modeOf(join(dir, temp as string))).toBe(0o600);
  release();
  await done;
  expect(readFileSync(path, "utf-8")).toBe("new");
  expect(temps()).toEqual([]);
});

test("a failed rename rejects and leaves the old file with no temp behind", async () => {
  const write = writeFileAtomic(path, "new", {
    mode: 0o600,
    fs: {
      writeFile,
      rename: async () => {
        throw new Error("EXDEV");
      },
    },
  });
  await expect(write).rejects.toThrow("EXDEV");
  expect(readFileSync(path, "utf-8")).toBe("old");
  expect(temps()).toEqual([]);
});

test("a failed cleanup does not mask the write's own failure", async () => {
  const write = writeFileAtomic(path, "new", {
    mode: 0o600,
    fs: {
      writeFile,
      rename: async () => {
        // The temp can no longer be unlinked from a directory that has lost its write bit.
        await chmod(dir, 0o500);
        throw new Error("EXDEV");
      },
    },
  });
  try {
    await expect(write).rejects.toThrow("EXDEV");
  } finally {
    await chmod(dir, 0o700);
  }
});

test("replacing a looser file leaves it at the requested mode", async () => {
  await chmod(path, 0o644);
  await writeFileAtomic(path, "new", { mode: 0o600 });
  expect(modeOf(path)).toBe(0o600);
});

test("writing through a symlink replaces its target and keeps the link", async () => {
  const link = join(dir, "link.json");
  await symlink(path, link);
  await writeFileAtomic(link, "new", { mode: 0o600 });
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(readFileSync(path, "utf-8")).toBe("new");
});
