// Pure formatters for the Advanced diagnostics pane (EXC-848): they turn the wire
// shapes — /api/diagnostics' uptime and its opaque, already-scrubbed settings
// graph — into the mono block text the pane renders and copies. No DOM, so each is
// a plain unit (diagnostics.test.ts) with no mount.

import { stringify } from "smol-toml";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Humanize the daemon uptime for the DAEMON block: seconds under a minute, whole
 * minutes under an hour, "{h}h {m}m" under a day, "{d}d {h}h" from a day on. */
export function formatUptime(ms: number): string {
  if (ms < MINUTE) return `${Math.floor(ms / 1000)}s`;
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ${Math.floor((ms % HOUR) / MINUTE)}m`;
  return `${Math.floor(ms / DAY)}d ${Math.floor((ms % DAY) / HOUR)}h`;
}

/** Narrow the effective daemon port out of the opaque diagnostics settings graph
 * (the daemon has already resolved env → file → default into it). Undefined when
 * the graph carries no numeric daemon.port. */
export function readDaemonPort(settings: unknown): number | undefined {
  if (typeof settings !== "object" || settings === null) return undefined;
  const daemon = (settings as Record<string, unknown>).daemon;
  if (typeof daemon !== "object" || daemon === null) return undefined;
  const port = (daemon as Record<string, unknown>).port;
  return typeof port === "number" ? port : undefined;
}

/** Serialize the parsed, scrubbed settings back to TOML for the CONFIG block —
 * reusing smol-toml, already the project's TOML library (src/config/settings.ts),
 * rather than hand-rolling a serializer. */
export function configToToml(settings: Record<string, unknown>): string {
  return stringify(settings);
}
