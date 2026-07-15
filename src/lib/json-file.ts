// Read-and-parse a JSON file, tolerating every failure as null: absent,
// unreadable, or malformed all collapse to null so callers can fall back without
// a try/catch of their own. The parsed value is `unknown` — each caller
// validates the shape it expects. For sites that need to distinguish failure
// modes (e.g. ENOENT vs other) keep a bespoke try/catch; this helper is for the
// "any failure → null" pattern only.

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

/** Synchronously read and JSON-parse `path`; null on any failure. */
export function readJsonFileSync(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/** Asynchronously read and JSON-parse `path`; null on any failure. */
export async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
}
