// The two lines caret writes into the user's config.toml: `[updates] check`, flipped by
// the Settings → Updates toggle (EXC-1354), and `[review] band`, flipped by the
// Settings → Notifications toggle.
//
// The edit is a text rewrite rather than a parse-and-stringify, because smol-toml's
// stringify would hand the user back a file stripped of their comments, ordering, and
// formatting. What makes that safe is the parse-verified net in withBoolean: a rewrite
// that changes anything but the one key refuses, and the caller leaves the file alone.
// Dotted keys, inline tables, and look-alike text inside a multi-line string all land
// there.

import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { parse as parseToml } from "smol-toml";

import { configFile } from "@/config/paths.ts";
import { writeFileAtomic } from "@/lib/atomic-write.ts";
import { createKeyedQueue } from "@/lib/keyed-queue.ts";

/** Mode for a config.toml caret creates itself; an existing file keeps its own. */
const NEW_FILE_MODE = 0o644;

// `[\s\S]` rather than `.` in the value-capturing group: lines are split on \n, so a CRLF
// file leaves a trailing \r that `.` and `$` will not cross.
const TABLE_HEADER = /^\s*\[\[?[^\]]*\]\]?\s*(#[^\n]*)?$/;

/** The parse with `table.key` — and a table left empty by its removal — taken out, so
 * two parses can be compared for "differs in nothing else". */
function withoutKey(parsed: unknown, table: string, key: string): unknown {
  if (typeof parsed !== "object" || parsed === null) return parsed;
  const out = { ...(parsed as Record<string, unknown>) };
  const section = out[table];
  if (typeof section === "object" && section !== null) {
    const rest = { ...(section as Record<string, unknown>) };
    delete rest[key];
    if (Object.keys(rest).length === 0) delete out[table];
    else out[table] = rest;
  }
  return out;
}

function parseOrNull(text: string): unknown | null {
  try {
    return parseToml(text);
  } catch {
    return null;
  }
}

/** Rewrite the `[table] key` boolean line, returning the new text — or null when that
 * cannot be done without risking the rest of the file. `table` and `key` are fixed
 * literals, so they go into the regexes unescaped. */
export function withBoolean(
  text: string,
  table: string,
  key: string,
  value: boolean,
): string | null {
  const before = parseOrNull(text);
  if (before === null) return null; // never touch a file caret cannot read

  const header = new RegExp(`^\\s*\\[${table}\\]\\s*(#[^\\n]*)?$`);
  const keyLine = new RegExp(`^(\\s*${key}\\s*=\\s*)(true|false)([\\s\\S]*)$`);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split("\n");
  const headerLine = lines.findIndex((l) => header.test(l));

  let next: string;
  if (headerLine === -1) {
    const separator = text === "" ? "" : text.endsWith("\n") ? eol : `${eol}${eol}`;
    next = `${text}${separator}[${table}]${eol}${key} = ${value}${eol}`;
  } else {
    const nextHeaderIndex = lines.findIndex((l, i) => i > headerLine && TABLE_HEADER.test(l));
    const tableEnd = nextHeaderIndex === -1 ? lines.length : nextHeaderIndex;
    const keyLineIndex = lines.findIndex(
      (l, i) => i > headerLine && i < tableEnd && keyLine.test(l),
    );
    if (keyLineIndex === -1) {
      lines.splice(headerLine + 1, 0, `${key} = ${value}${eol === "\r\n" ? "\r" : ""}`);
    } else {
      lines[keyLineIndex] = (lines[keyLineIndex] as string).replace(keyLine, `$1${value}$3`);
    }
    next = lines.join("\n");
  }

  const after = parseOrNull(next);
  if (after === null) return null;
  if ((after as Record<string, Record<string, unknown> | undefined>)[table]?.[key] !== value) {
    return null;
  }
  if (!isDeepStrictEqual(withoutKey(before, table, key), withoutKey(after, table, key))) {
    return null;
  }
  return next;
}

/** Why a config.toml rewrite did not land. */
export type ConfigRefusal = "unreadable" | "unverifiable" | "unwritable";

export interface ConfigWriter {
  /** Flip `[updates] check` in the user's config.toml. On a refusal the file is left
   * untouched. */
  setUpdatesCheck(check: boolean): Promise<WriteResult>;
  /** Flip `[review] band`, with the same refusal contract. */
  setReviewBand(band: boolean): Promise<WriteResult>;
}

type WriteResult = { ok: true } | { ok: false; reason: ConfigRefusal };

/** Build the writer the config write path uses. Writes queue per file, so two flips
 * cannot both read the pre-write text and lose one another's edit. */
export function createConfigWriter(file = configFile()): ConfigWriter {
  const writes = createKeyedQueue();
  async function setBoolean(table: string, key: string, value: boolean): Promise<WriteResult> {
    let refusal: ConfigRefusal | null = null;
    await writes.run(file, async () => {
      // ENOENT alone reads as empty — that is a first write creating the file. Any
      // other failure would leave the net below comparing against nothing, and replace
      // a file caret cannot see.
      const current = await readFile(file, "utf-8").catch((e: NodeJS.ErrnoException) =>
        e.code === "ENOENT" ? "" : null,
      );
      if (current === null) {
        refusal = "unreadable";
        return;
      }
      const next = withBoolean(current, table, key, value);
      if (next === null) {
        refusal = "unverifiable";
        return;
      }
      if (next === current) return;
      // A config.toml caret creates itself is ordinary user-editable config, unlike
      // the 0600 state dir; an existing one keeps whatever mode its owner gave it.
      const mode = await stat(file).then(
        (s) => s.mode & 0o777,
        () => NEW_FILE_MODE,
      );
      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFileAtomic(file, next, { mode });
      } catch {
        // Reported, not thrown: the boot migration path (prefs.ts) has nothing to
        // catch an escaping error, and it would crash the daemon before it starts.
        refusal = "unwritable";
      }
    });
    return refusal === null ? { ok: true } : { ok: false, reason: refusal };
  }
  return {
    setUpdatesCheck: (check) => setBoolean("updates", "check", check),
    setReviewBand: (band) => setBoolean("review", "band", band),
  };
}
