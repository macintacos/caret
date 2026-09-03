// Shared subcommand boot helpers. A typo'd CARET_* var silently falls through to
// the config file, then the default — surface it once at boot so "why is it on
// the default port?" is answerable from the log. The warn sink is a parameter so
// the daemon (its own CaretLogger) and the short-lived hook (logWarn into
// caret.log) share the loop while keeping their distinct loggers; each emits
// under the "env" step at warn level.

import { invalidEnvVars, logKeep, logMaxSize, type Settings } from "@/config/settings.ts";
import { logWarn, setLogLevel, setLogRotation, setRedact } from "@/lib/log.ts";

/** Warn once per invalid CARET_* env var through the given sink. The sink emits
 * the message under whichever logger the caller holds. */
export function warnInvalidEnvVars(warn: (msg: string) => void): void {
  for (const name of invalidEnvVars()) warn(`${name} invalid; using config/default`);
}

/** Apply a settings snapshot to the shared hook logger and surface any invalid
 * CARET_* var, before anything the subcommand does can emit. The snapshot is a
 * parameter because both hook subcommands read it once and go on to draw their
 * own tunables from that same read. */
export function bootHookLogging(loaded: Settings): void {
  setLogLevel(loaded.logging.level);
  setRedact(loaded.logging.redact);
  setLogRotation(logMaxSize(loaded), logKeep(loaded));
  warnInvalidEnvVars((msg) => logWarn("env", msg));
}
