// The one key caret writes into config.toml: `[daemon] resident`, persisted by
// `caret install --no-resident` so the opt-out survives the next install (EXC-1167).
// The edit is textual rather than a smol-toml round-trip because config.toml is
// hand-authored — stringify would reserialize the whole file and drop its comments.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { configFile } from "@/config/paths.ts";

const HEADER = "[daemon]";

/** `text` with `[daemon] resident` set to `resident`, every other line untouched. */
export function setDaemonResident(text: string, resident: boolean): string {
  const entry = `resident = ${resident}`;
  const lines = text.split("\n");
  const header = lines.findIndex((line) => line.trim() === HEADER);
  if (header === -1) {
    const existing = text.trim() === "" ? "" : `${text.trimEnd()}\n\n`;
    return `${existing}${HEADER}\n${entry}\n`;
  }
  // The table ends at the next header, so a `resident` key belonging to another table
  // is never the one rewritten.
  const next = lines.findIndex((line, i) => i > header && line.trimStart().startsWith("["));
  const end = next === -1 ? lines.length : next;
  const key = lines.findIndex((line, i) => i > header && i < end && /^\s*resident\s*=/.test(line));
  if (key === -1) lines.splice(header + 1, 0, entry);
  else lines[key] = entry;
  return lines.join("\n");
}

/** Persist the key to `file`, creating the config and its directory when absent. */
export function writeDaemonResident(resident: boolean, file = configFile()): void {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    // Absent or unreadable: the edit starts from an empty config either way.
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, setDaemonResident(text, resident));
}
