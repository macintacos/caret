// The daemon auth token file: persistence only — read it, and mint it owner-only
// when missing.

import { randomBytes } from "node:crypto";
import { linkSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { ensureStateDir } from "@/config/paths.ts";

/** The token in `file`, trimmed; null when the file is missing, empty, or unreadable. */
export function readToken(file: string): string | null {
  try {
    return readFileSync(file, "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** Load the daemon token, minting a 256-bit one (owner-only, 0600) when `file` is missing.
 * The mint lands whole through `link`, so a concurrent boot reads the winner's token. */
export function loadOrMintToken(file: string): string {
  const existing = readToken(file);
  if (existing !== null) return existing;
  const token = randomBytes(32).toString("base64url");
  ensureStateDir(dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, token, { mode: 0o600 });
  try {
    linkSync(tmp, file);
    return token;
  } catch (e) {
    if ((e as { code?: string }).code !== "EEXIST") throw e;
    const winner = readToken(file);
    if (winner === null)
      throw new Error(`caret daemon token file ${file} exists but holds no readable token`);
    return winner;
  } finally {
    rmSync(tmp, { force: true });
  }
}
