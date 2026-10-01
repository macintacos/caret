// A fake `opencode` binary for suites that probe `opencode --version`.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Writes `<dir>/opencode` as a shell script running `body`, creating `dir`; returns its path. */
export function writeOpencodeShim(dir: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  const bin = join(dir, "opencode");
  writeFileSync(bin, `#!/bin/sh\n${body}\n`);
  chmodSync(bin, 0o755);
  return bin;
}
