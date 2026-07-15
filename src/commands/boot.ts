// Shared subcommand boot helper. A typo'd CARET_* var silently falls through to
// the config file, then the default — surface it once at boot so "why is it on
// the default port?" is answerable from the log. The warn sink is a parameter so
// the daemon (its own CaretLogger) and the short-lived hook (logWarn into
// caret.log) share the loop while keeping their distinct loggers; each emits
// under the "env" step at warn level.

import { invalidEnvVars } from "@/config/settings.ts";

/** Warn once per invalid CARET_* env var through the given sink. The sink emits
 * the message under whichever logger the caller holds. */
export function warnInvalidEnvVars(warn: (msg: string) => void): void {
  for (const name of invalidEnvVars()) warn(`${name} invalid; using config/default`);
}
