// The one line caret writes into the user's config.toml: `[updates] check`, flipped by
// the Settings → Updates toggle (EXC-1354).
//
// The edit is a text rewrite rather than a parse-and-stringify, because smol-toml's
// stringify would hand the user back a file stripped of their comments, ordering, and
// formatting. What makes that safe is the parse-verified net in withUpdatesCheck: a
// rewrite that changes anything but `updates.check` refuses, and the caller leaves the
// file alone. Dotted keys, inline tables, and look-alike text inside a multi-line string
// all land there.

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
const UPDATES_HEADER = /^\s*\[updates\]\s*(#[^\n]*)?$/;
const CHECK_LINE = /^(\s*check\s*=\s*)(true|false)([\s\S]*)$/;

/** The parse with `updates.check` — and an `updates` table left empty by its removal —
 * taken out, so two parses can be compared for "differs in nothing else". */
function withoutUpdatesCheck(parsed: unknown): unknown {
  if (typeof parsed !== "object" || parsed === null) return parsed;
  const out = { ...(parsed as Record<string, unknown>) };
  const updates = out.updates;
  if (typeof updates === "object" && updates !== null) {
    const rest = { ...(updates as Record<string, unknown>) };
    delete rest.check;
    if (Object.keys(rest).length === 0) delete out.updates;
    else out.updates = rest;
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

/** Rewrite the `[updates] check` line, returning the new text — or null when that
 * cannot be done without risking the rest of the file. */
export function withUpdatesCheck(text: string, check: boolean): string | null {
  const before = parseOrNull(text);
  if (before === null) return null; // never touch a file caret cannot read

  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split("\n");
  const header = lines.findIndex((l) => UPDATES_HEADER.test(l));

  let next: string;
  if (header === -1) {
    const separator = text === "" ? "" : text.endsWith("\n") ? eol : `${eol}${eol}`;
    next = `${text}${separator}[updates]${eol}check = ${check}${eol}`;
  } else {
    const end = lines.findIndex((l, i) => i > header && TABLE_HEADER.test(l));
    const stop = end === -1 ? lines.length : end;
    const at = lines.findIndex((l, i) => i > header && i < stop && CHECK_LINE.test(l));
    if (at === -1) {
      lines.splice(header + 1, 0, `check = ${check}${eol === "\r\n" ? "\r" : ""}`);
    } else {
      lines[at] = (lines[at] as string).replace(CHECK_LINE, `$1${check}$3`);
    }
    next = lines.join("\n");
  }

  const after = parseOrNull(next);
  if (after === null) return null;
  if ((after as { updates?: { check?: unknown } }).updates?.check !== check) return null;
  if (!isDeepStrictEqual(withoutUpdatesCheck(before), withoutUpdatesCheck(after))) return null;
  return next;
}

/** Why a config.toml rewrite did not land. */
export type ConfigRefusal = "unreadable" | "unverifiable" | "unwritable";

export interface ConfigWriter {
  /** Flip `[updates] check` in the user's config.toml. On a refusal the file is left
   * untouched. */
  setUpdatesCheck(check: boolean): Promise<{ ok: true } | { ok: false; reason: ConfigRefusal }>;
}

/** Build the writer the config write path uses. Writes queue per file, so two flips
 * cannot both read the pre-write text and lose one another's edit. */
export function createConfigWriter(file = configFile()): ConfigWriter {
  const writes = createKeyedQueue();
  return {
    async setUpdatesCheck(check) {
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
        const next = withUpdatesCheck(current, check);
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
          // Reported, not thrown: this runs on the boot path, where an escaping error
          // would take the daemon down rather than leave prefs.json for the next boot.
          refusal = "unwritable";
        }
      });
      return refusal === null ? { ok: true } : { ok: false, reason: refusal };
    },
  };
}
