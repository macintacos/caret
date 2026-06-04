// User-editable settings: ~/.config/caret/config.toml (see paths.configFile),
// parsed with smol-toml and validated by a zod schema that supplies a default
// for every key. The file is user-authored — caret never writes it.
//
// Contract (EXC-429): reads NEVER throw. An absent, malformed, partial, or
// invalid file falls back to last-known-good, then DEFAULTS. Invalid values
// fall back at whole-file granularity (one bad key reverts the entire file
// until fixed). Unknown keys are stripped at every level for forward-compat —
// which also means a typo'd known key (e.g. `levle`) is silently ignored.
//
// Consumers: the short-lived `caret review` hook calls loadSettings() (single
// synchronous load); the daemon holds the settings() singleton (EXC-398/399/
// 400 wire the first real readers).

import { readFileSync, statSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import { logError } from "./log.ts";
import { configFile } from "./paths.ts";

const SettingsSchema = z.object({
  logging: z
    .object({
      level: z.enum(["debug", "info", "warn", "error"]).default("info"), // EXC-398
      debug: z.boolean().default(false), // EXC-400
      redact: z.boolean().default(true), // EXC-399
    })
    // zod 4: .default() does NOT parse its value, .prefault({}) runs {} through
    // the inner schema so a missing [logging] table picks up every key default.
    .prefault({}),
});

export type Settings = z.infer<typeof SettingsSchema>;

/** Settings are shared across callers (DEFAULTS, the service's lastGood
 * cache) — freeze so no consumer can mutate another's view. */
function freeze(s: Settings): Settings {
  Object.freeze(s.logging);
  return Object.freeze(s);
}

/** Every key at its schema default ({} has defaults for all keys, so this
 * never throws). */
export const DEFAULTS: Settings = freeze(SettingsSchema.parse({}));

/** Log a validation failure with the offending key path and zod code ONLY —
 * never issue.message/received/expected, which can embed raw config values
 * (config contents must not leak into logs; coordinates with EXC-399). */
function logValidationFailure(err: z.ZodError): void {
  const safe = err.issues
    .map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.code}`)
    .join("; ");
  logError("settings", new Error(`config.toml ignored — invalid: ${safe}`));
}

/** Parse + validate TOML text; null means "unusable" (malformed or invalid)
 * and the caller decides the fallback. Invalid values fall back at whole-file
 * granularity: one bad key reverts the entire file until it is fixed. */
function parseAndValidate(text: string): Settings | null {
  let raw: unknown;
  try {
    raw = parseToml(text);
  } catch {
    return null; // malformed TOML, including partial/mid-write states
  }
  const res = SettingsSchema.safeParse(raw);
  if (!res.success) {
    logValidationFailure(res.error);
    return null;
  }
  return freeze(res.data);
}

/** One-shot synchronous load for the short-lived hook process. Never throws:
 * an absent/unreadable file or unusable content yields DEFAULTS. */
export function loadSettings(file = configFile()): Settings {
  let text: string;
  try {
    text = readFileSync(file, "utf-8");
  } catch {
    return DEFAULTS; // absent or unreadable file
  }
  return parseAndValidate(text) ?? DEFAULTS;
}

export interface SettingsService {
  /** Latest valid settings. Re-reads only when the file's mtime or size
   * changed since the last look; otherwise serves the cached parse. */
  current(): Settings;
}

/** Stat-gated cache for the long-running daemon: edits to config.toml take
 * effect without a restart. mtime granularity can be ~1s on some filesystems,
 * so size disambiguates; two same-size edits within the same second may not be
 * detected until the next change (accepted). */
export function createSettings(file = configFile()): SettingsService {
  let lastGood = DEFAULTS;
  let lastSig: { mtimeMs: number; size: number } | null = null;
  return {
    current() {
      let st: { mtimeMs: number; size: number };
      try {
        st = statSync(file);
      } catch {
        // Absent (never existed -> DEFAULTS) or deleted mid-run / slow FS
        // (-> last valid parse). Don't revert a running daemon on a transient
        // unlink.
        return lastGood;
      }
      if (lastSig && st.mtimeMs === lastSig.mtimeMs && st.size === lastSig.size) {
        return lastGood;
      }
      let text: string;
      try {
        text = readFileSync(file, "utf-8");
      } catch {
        return lastGood; // any read error: raced delete, EACCES, slow FS
      }
      const next = parseAndValidate(text);
      // Advance the signature even on failure so a static bad file isn't
      // re-parsed (and re-logged) on every get; a later edit re-triggers.
      lastSig = { mtimeMs: st.mtimeMs, size: st.size };
      if (next !== null) lastGood = next; // parse into a temp, swap on success
      return lastGood;
    },
  };
}

let singleton: SettingsService | undefined;

/** Lazy module-level singleton — the daemon's one settings instance,
 * instantiated (warmed) at startup in runDaemon(). */
export function settings(): SettingsService {
  singleton ??= createSettings();
  return singleton;
}
