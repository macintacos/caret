// The one key caret writes into config.toml: `[daemon] resident`, persisted by
// `caret install --no-resident` so the opt-out survives the next install (EXC-1167).
// The edit is textual rather than a smol-toml round-trip because config.toml is
// hand-authored — stringify would reserialize the whole file and drop its comments.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { configFile } from "@/config/paths.ts";

const TABLE = "daemon";

/** The table a line opens, or undefined for anything else. Matching on the brackets
 * rather than the whole line is what keeps `[daemon] # knobs` and `[ daemon ]` the same
 * table: missing one appends a second `[daemon]`, which smol-toml rejects — taking the
 * user's whole config down to defaults, resident among them. */
function tableName(line: string): string | undefined {
  return /^\s*\[\s*([^\]]*?)\s*\]/.exec(line)?.[1];
}

/** `text` with `[daemon] resident` set to `resident`, every other line untouched. */
export function setDaemonResident(text: string, resident: boolean): string {
  const entry = `resident = ${resident}`;
  const lines = text.split("\n");
  const header = lines.findIndex((line) => tableName(line) === TABLE);
  if (header === -1) {
    const existing = text.trim() === "" ? "" : `${text.trimEnd()}\n\n`;
    return `${existing}[${TABLE}]\n${entry}\n`;
  }
  // The table ends at the next header, so a `resident` key belonging to another table
  // is never the one rewritten.
  const next = lines.findIndex((line, i) => i > header && tableName(line) !== undefined);
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
  } catch (e) {
    // Only "no config yet" starts from an empty one. Any other read failure means a
    // config that is there and unreadable right now, and writing would replace it with
    // two lines; the caller reports the throw instead.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  mkdirSync(dirname(file), { recursive: true });
  // Land atomically, like installLauncher: a truncating in-place write that is
  // interrupted leaves a half-config, which loadSettings reads as unparseable and
  // silently degrades to defaults.
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, setDaemonResident(text, resident), { mode: 0o600 });
  renameSync(tmp, file);
}
