// OpenAI Codex CLI's install probe for the discovery command: a best-effort,
// strictly read-only read of caret's Codex hook state from `~/.codex`. Mirrors
// claude/install.ts's structure and degrade-to-"unknown" discipline — every field
// degrades to "unknown" rather than throwing, so discovery always renders the
// install-state section. Reads ONLY caret's own entries — never any other config
// key (privacy).
//
// The probed paths are modeled from docs/research (EXC-532), NOT verified against
// a live Codex install: Codex reads hooks from `~/.codex/hooks.json` or the
// `[hooks]` table in `~/.codex/config.toml`, gated behind `[features]
// codex_hooks = true`. caret ships no Codex packaging yet, so:
//   - pluginVersion   — always "unknown" (no Codex-side caret package to read).
//   - pluginEnabled    — the `[features] codex_hooks` flag in config.toml: the
//                        feature gate the hook needs, mapped onto the generic
//                        "tool has caret enabled" field. "unknown" when config.toml
//                        is absent/unreadable.
//   - hookInUserSettings — whether a manual caret hook command sits in
//                        ~/.codex/hooks.json. The normally-false probe: with no
//                        Codex packaging, a configured hook is always manual.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { parse as parseToml } from "smol-toml";

import type { InstallProbe } from "@/adapters/adapter.ts";
import { readJsonFileSync } from "@/lib/json-file.ts";

/** The Codex CLI config dir: CODEX_HOME override, else ~/.codex. */
function codexConfigDir(): string {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

/** Best-effort read of caret's Codex install state. Every miss degrades to
 * "unknown". */
export function readCodexInstallState(): InstallProbe {
  const dir = codexConfigDir();
  return {
    // No Codex-side caret package exists yet, so there is no version to read.
    pluginVersion: "unknown",
    pluginEnabled: readCodexHooksFeature(join(dir, "config.toml")),
    hookInUserSettings: readHookInUserSettings(join(dir, "hooks.json")),
  };
}

/** Read the `[features] codex_hooks` gate from config.toml. "unknown" when the
 * file is absent/unreadable/unparseable; otherwise the boolean (defaulting an
 * absent flag to false — the feature is off until explicitly enabled). */
function readCodexHooksFeature(path: string): boolean | "unknown" {
  let parsed: unknown;
  try {
    parsed = parseToml(readFileSync(path, "utf-8"));
  } catch {
    // Absent, unreadable, or invalid TOML — indistinguishable here, all "unknown".
    return "unknown";
  }
  const features = (parsed as { features?: unknown })?.features;
  if (features === undefined || features === null || typeof features !== "object") return false;
  const enabled = (features as { codex_hooks?: unknown }).codex_hooks;
  return typeof enabled === "boolean" ? enabled : false;
}

/** Hunt a manual caret hook command in ~/.codex/hooks.json. Defensive at each
 * hop: a malformed shape just yields no match (false), never a throw. "unknown"
 * only when the file itself is absent/unreadable. */
function readHookInUserSettings(path: string): boolean | "unknown" {
  const json = readJsonFileSync(path);
  if (json === null || typeof json !== "object") return "unknown";
  // The Codex hooks.json shape is provisional (EXC-532): walk every value looking
  // for any string command that runs `caret review`/`caret prewarm`, so the probe
  // tolerates whatever nesting the live format turns out to use.
  return containsCaretHookCommand(json);
}

/** Recursively scan an arbitrary JSON value for a string that invokes a caret
 * hook command. Depth-bounded implicitly by the parsed config's own structure. */
function containsCaretHookCommand(value: unknown): boolean {
  if (typeof value === "string") {
    return value.includes("caret review") || value.includes("caret prewarm");
  }
  if (Array.isArray(value)) {
    return value.some(containsCaretHookCommand);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(containsCaretHookCommand);
  }
  return false;
}
