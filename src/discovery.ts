// Read-only diagnostics snapshot for `caret discovery` (EXC-464): a one-shot,
// ALWAYS-REDACTED picture of the local install for pasting into a bug report.
// This module assembles the document and renders it; it NEVER mutates anything
// (no lock cleanup, no file writes) and NEVER logs — its output IS the report.
//
// Two design rules shape the surface:
//
//   - Every side effect is injected (DiscoveryDeps), so collectReport is a pure
//     function of its deps and the whole document is unit-testable with fakes —
//     the same dependency-injection pattern src/cli.ts uses for runReview.
//   - The report is built FLAT on purpose. src/redact.ts caps recursion at depth
//     6 (deeper values become "<depth-capped>"); keeping every leaf shallow
//     (the deepest is processes.items[i].field at depth 4) means the CLI caller's
//     scrubValue(report, true) never clips a value. Sections that would nest —
//     settings, lockAndPort, reviews — are flattened to dotted/prefixed scalar
//     keys to hold that budget.
//
// collectReport does NOT redact: the CLI caller scrubs the finished document
// (always, regardless of [logging].redact) before printing.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { shortId } from "./log.ts";
import type { DaemonLock } from "./paths.ts";
import { reviewsDir } from "./paths.ts";
import type { Settings } from "./settings.ts";

// ---------------------------------------------------------------------------
// Injected probe shapes
// ---------------------------------------------------------------------------

/** Parsed /api/health identity body. Every field optional: a pre-fix daemon or
 * a non-caret squatter may omit any of them. */
export interface HealthIdentity {
  service?: string;
  version?: string;
  build?: string;
  commit?: string;
}

/** A live process, identified by pid and its command name only. argv is NEVER
 * captured — it can embed identifying paths (privacy). */
export interface ProcessEntry {
  pid: number;
  name: string;
}

/** The two fields plucked from a persisted review file. NEVER carries plan or
 * draft bodies. */
export interface ReviewStatusRecord {
  id: string;
  status: string;
}

/** Best-effort read of the Claude Code install: every field degrades to
 * "unknown" rather than throwing or omitting. */
export interface ClaudeInstallState {
  pluginVersion: string | "unknown";
  pluginEnabled: boolean | "unknown";
  hookInUserSettings: boolean | "unknown";
}

/** Bounded summary of a log file: counts only, never log text. */
export interface LogStats {
  path: string;
  exists: boolean;
  size: number;
  errors: number;
  warns: number;
}

/** Every side-effecting input the report needs, injected so collectReport is a
 * pure function of its deps (the CLI phase wires the prod readers below). */
export interface DiscoveryDeps {
  /** ISO timestamp source (injectable for tests). */
  now: () => Date;
  /** This binary's caret version (paths.VERSION in prod). */
  version: string;
  system: () => { platform: string; os: string; arch: string };
  install: () => { kind: "dev" | "prod"; binaryPath: string; bunVersion: string };
  /** Resolved config.toml values (loadSettings() in prod — never throws). */
  settings: () => Settings;
  configPath: string;
  configExists: () => boolean;
  /** Effective tunables (env > file > default), resolved by the caller. */
  effective: () => { port: number; idleMs: number; reviewTimeoutMs: number; heartbeatMs: number };
  baseUrl: string;
  /** Parsed /api/health body or null when unreachable (httpHealth in prod; 500ms bounded). */
  health: (baseUrl: string) => Promise<HealthIdentity | null>;
  readLock: () => DaemonLock | null;
  isPidAlive: (pid: number) => boolean;
  listProcesses: () => ProcessEntry[];
  listReviewFiles: () => ReviewStatusRecord[];
  readClaudeInstallState: () => ClaudeInstallState;
  logStats: (path: string) => Promise<LogStats>;
  logPaths: { caret: string; daemon: string };
}

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

/** A section that threw during collection: it degrades to this rather than
 * failing the whole report. The string is the error's message (or String(e)). */
export interface SectionError {
  error: string;
}

/** Flat-by-design so scrubValue's depth-6 cap never clips a leaf. */
export interface Report {
  schema: "caret-discovery/1";
  version: string;
  generatedAt: string;
  system: { platform: string; os: string; arch: string } | SectionError;
  install: { kind: string; binaryPath: string; bunVersion: string } | SectionError;
  settings: Record<string, unknown> | SectionError;
  daemon: Record<string, unknown> | SectionError;
  lockAndPort: Record<string, unknown> | SectionError;
  processes: { count: number; items: ProcessItem[] } | SectionError;
  reviews: ReviewsSection | SectionError;
  installState: ClaudeInstallState | SectionError;
  logs: { caret: LogStats; daemon: LogStats } | SectionError;
}

/** A merged process entry: the listed caret processes plus (when alive and not
 * already listed) the daemon lock's pid, each tagged with how it was found. */
export interface ProcessItem {
  pid: number;
  name: string;
  identifiedBy: "ps comm" | "daemon.lock";
}

/** Review tallies plus a capped, truncated sample of pending ids. */
export interface ReviewsSection {
  pending: number;
  approved: number;
  rejected: number;
  expired: number;
  other: number;
  total: number;
  pendingIds: string[];
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Run one section builder, degrading a throw to { error } so a single failing
 * probe can never reject the whole report. Error → message, else String(e). */
function safe<T>(build: () => T): T | SectionError {
  try {
    return build();
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Async variant for sections whose probe returns a Promise (logs). */
async function safeAsync<T>(build: () => Promise<T>): Promise<T | SectionError> {
  try {
    return await build();
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Assemble the diagnostics document. Never rejects: every section is wrapped
 * in safe()/safeAsync(). Does NOT redact — the CLI caller scrubs. The daemon
 * health is probed ONCE (one bounded network call) and shared between the
 * `daemon` and `lockAndPort` sections. */
export async function collectReport(deps: DiscoveryDeps): Promise<Report> {
  // One bounded health probe, shared. Wrapped so a throwing health() can't sink
  // collectReport; both sections see null (treated as unreachable) on failure.
  let health: HealthIdentity | null = null;
  let healthError: SectionError | null = null;
  try {
    health = await deps.health(deps.baseUrl);
  } catch (e) {
    healthError = { error: e instanceof Error ? e.message : String(e) };
  }

  return {
    schema: "caret-discovery/1",
    version: deps.version,
    generatedAt: deps.now().toISOString(),
    system: safe(() => deps.system()),
    install: safe(() => deps.install()),
    settings: safe(() => buildSettings(deps)),
    daemon: healthError ?? safe(() => buildDaemon(health)),
    lockAndPort: healthError ?? safe(() => buildLockAndPort(deps, health)),
    processes: safe(() => buildProcesses(deps)),
    reviews: safe(() => tallyReviews(deps.listReviewFiles())),
    installState: safe(() => deps.readClaudeInstallState()),
    logs: await safeAsync(() => buildLogs(deps)),
  };
}

/** Flatten the settings/effective values to dotted/prefixed scalar keys (the
 * depth-budget discipline). */
function buildSettings(deps: DiscoveryDeps): Record<string, unknown> {
  const s = deps.settings();
  const e = deps.effective();
  return {
    configPath: deps.configPath,
    configExists: deps.configExists(),
    "logging.level": s.logging.level,
    "logging.redact": s.logging.redact,
    "daemon.port": s.daemon.port,
    "daemon.idleMs": s.daemon.idle_ms,
    "daemon.heartbeatMs": s.daemon.heartbeat_ms,
    "review.timeoutS": s.review.timeout_s,
    effectivePort: e.port,
    effectiveIdleMs: e.idleMs,
    effectiveTimeoutMs: e.reviewTimeoutMs,
    effectiveHeartbeatMs: e.heartbeatMs,
  };
}

/** The daemon section from the shared health probe: unreachable (null) →
 * { reachable: false }; reachable → its identity, whatever service it claims
 * (a non-caret squatter still shows reachable, with its own service). */
function buildDaemon(health: HealthIdentity | null): Record<string, unknown> {
  if (!health) return { reachable: false };
  return {
    reachable: true,
    service: health.service,
    daemonVersion: health.version,
    build: health.build,
    commit: health.commit,
  };
}

/** The lock + port reconciliation, flattened. portServesCaret comes from the
 * shared health probe (service === "caret"); portMismatch compares the lock's
 * port to the effective port. No lock → { lockExists: false, portServesCaret }. */
function buildLockAndPort(
  deps: DiscoveryDeps,
  health: HealthIdentity | null,
): Record<string, unknown> {
  const portServesCaret = health?.service === "caret";
  const lock = deps.readLock();
  if (!lock) return { lockExists: false, portServesCaret };
  return {
    lockExists: true,
    lockPid: lock.pid,
    lockPort: lock.port,
    lockBuild: lock.build,
    lockVersion: lock.version,
    lockStartedAt: lock.startedAt,
    pidAlive: deps.isPidAlive(lock.pid),
    portServesCaret,
    portMismatch: lock.port !== deps.effective().port,
  };
}

/** Merge the listed caret processes with the lock pid: a live, unlisted lock
 * pid is appended, tagged "daemon.lock", so the report shows the daemon even
 * when `ps` filtering missed it. */
function buildProcesses(deps: DiscoveryDeps): { count: number; items: ProcessItem[] } {
  const items: ProcessItem[] = deps
    .listProcesses()
    .map((p) => ({ pid: p.pid, name: p.name, identifiedBy: "ps comm" as const }));
  const lock = deps.readLock();
  if (lock && deps.isPidAlive(lock.pid) && !items.some((i) => i.pid === lock.pid)) {
    items.push({ pid: lock.pid, name: "caret", identifiedBy: "daemon.lock" });
  }
  return { count: items.length, items };
}

async function buildLogs(deps: DiscoveryDeps): Promise<{ caret: LogStats; daemon: LogStats }> {
  // The two files are independent — stat/read them concurrently.
  const [caret, daemon] = await Promise.all([
    deps.logStats(deps.logPaths.caret),
    deps.logStats(deps.logPaths.daemon),
  ]);
  return { caret, daemon };
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for direct unit testing)
// ---------------------------------------------------------------------------

/** Tally review statuses into the reviews section. Unknown statuses land in
 * `other`; pendingIds samples up to 8 pending ids, each truncated to 8 chars
 * via shortId (the full pending count still rides in `pending`). */
export function tallyReviews(records: ReviewStatusRecord[]): ReviewsSection {
  const counts = { pending: 0, approved: 0, rejected: 0, expired: 0, other: 0 };
  const pendingIds: string[] = [];
  for (const r of records) {
    switch (r.status) {
      case "pending":
        counts.pending++;
        if (pendingIds.length < 8) pendingIds.push(shortId(r.id));
        break;
      case "approved":
        counts.approved++;
        break;
      case "rejected":
        counts.rejected++;
        break;
      case "expired":
        counts.expired++;
        break;
      default:
        counts.other++;
    }
  }
  return { ...counts, total: records.length, pendingIds };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** The report's scalar header fields — everything else is a renderable
 * section, so a future Report field can't silently vanish from the render. */
const HEADER_KEYS = new Set(["schema", "version", "generatedAt"]);

/** Render the (already-scrubbed) report as plain text: a header line, then one
 * titled block per section with aligned `key: value` lines. No ANSI. Never
 * throws — a degraded { error } section renders one error line, and missing
 * keys are simply absent. */
export function renderReport(report: Report): string {
  const lines: string[] = [];
  lines.push(
    `caret discovery (${report.schema}) version ${report.version} at ${report.generatedAt}`,
  );
  const sections = Object.entries(report).filter(([key]) => !HEADER_KEYS.has(key));
  for (const [title, value] of sections) {
    lines.push("");
    lines.push(`${title}:`);
    lines.push(...renderSection(title, value));
  }
  return lines.join("\n");
}

function isSectionError(v: unknown): v is SectionError {
  return (
    typeof v === "object" &&
    v !== null &&
    "error" in v &&
    typeof (v as SectionError).error === "string"
  );
}

/** Render one section's body. A degraded section is a single error line; an
 * object is aligned key:value lines; arrays/nested objects render one item per
 * line. */
function renderSection(title: string, value: unknown): string[] {
  if (isSectionError(value)) return [`  ${title} error: ${value.error}`];
  if (value === null || typeof value !== "object") return [`  ${String(value)}`];
  const entries = Object.entries(value as Record<string, unknown>);
  const width = entries.reduce((w, [k]) => Math.max(w, k.length), 0);
  const out: string[] = [];
  for (const [k, v] of entries) {
    if (Array.isArray(v)) {
      out.push(`  ${k.padEnd(width)} :`);
      for (const item of v) out.push(`    ${formatValue(item)}`);
    } else {
      out.push(`  ${k.padEnd(width)} : ${formatValue(v)}`);
    }
  }
  return out;
}

/** Format a leaf value for a render line. Objects (a nested LogStats) become a
 * compact JSON string; scalars stringify directly. */
function formatValue(v: unknown): string {
  if (v === null || typeof v !== "object") return String(v);
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// Production probe readers (exported; wired by the later CLI phase). Each is
// individually bounded and strictly read-only.
// ---------------------------------------------------------------------------

/** Parse `ps -axo pid=,comm=` output into ProcessEntry[]: one `pid comm` pair
 * per line, comm basenamed, filtered to entries named exactly "caret". Pure so
 * it's unit-testable without spawning. */
export function parsePsLines(text: string): ProcessEntry[] {
  const out: ProcessEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d+)\s+(.+)$/);
    const [, pidStr, comm] = m ?? [];
    if (pidStr === undefined || comm === undefined) continue;
    const name = basename(comm.trim());
    if (name === "caret") out.push({ pid: Number(pidStr), name });
  }
  return out;
}

/** List live caret processes via `ps` (1.5s timeout, no argv — privacy). A
 * non-zero exit or spawn failure yields []. */
export function listProcesses(): ProcessEntry[] {
  try {
    const r = Bun.spawnSync(["ps", "-axo", "pid=,comm="], { timeout: 1500 });
    if (r.exitCode !== 0) return [];
    return parsePsLines(r.stdout.toString());
  } catch {
    return [];
  }
}

/** Read up to 5000 review files, plucking ONLY { id, status } from each. An
 * absent dir, or any corrupt/unreadable file, is skipped silently (mirroring
 * store.rehydrate's tolerance). NEVER reads plan / draft bodies. */
export function listReviewFiles(): ReviewStatusRecord[] {
  const dir = reviewsDir();
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return []; // absent dir — a normal first run
  }
  const out: ReviewStatusRecord[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    if (out.length >= 5000) break;
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), "utf-8")) as {
        id?: unknown;
        status?: unknown;
      };
      if (typeof raw.id === "string" && typeof raw.status === "string") {
        out.push({ id: raw.id, status: raw.status });
      }
    } catch {
      // corrupt/unreadable — skip, like store.rehydrate.
    }
  }
  return out;
}

/** The bounded tail size for logStats: the last 256 KiB is plenty to gauge
 * recent error/warn pressure without reading a huge file. */
const TAIL_BYTES = 256 * 1024;

/** Bounded, count-only summary of a log file. Reads at most the last 256 KiB,
 * drops a possibly-partial first line when the file was larger than the slice,
 * and tallies level>=50 as errors / level===40 as warns. Returns ONLY
 * path/exists/size/errors/warns — never any log text. */
export async function logStats(path: string): Promise<LogStats> {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return { path, exists: false, size: 0, errors: 0, warns: 0 };
  }
  try {
    const start = Math.max(0, size - TAIL_BYTES);
    const text = await Bun.file(path).slice(start).text();
    const { errors, warns } = countLogLevels(text, start > 0);
    return { path, exists: true, size, errors, warns };
  } catch {
    // Unreadable despite existing (raced delete, EACCES): report exists+size,
    // no counts.
    return { path, exists: true, size, errors: 0, warns: 0 };
  }
}

/** Count error/warn NDJSON records in a log tail. When dropFirstLine is set
 * (the slice started mid-file), the first line may be a partial record and is
 * skipped. Only `{`-prefixed, parseable lines with a numeric level count;
 * everything else (raw crash output, malformed records) is ignored. */
export function countLogLevels(
  tailText: string,
  dropFirstLine: boolean,
): { errors: number; warns: number } {
  let errors = 0;
  let warns = 0;
  const lines = tailText.split("\n");
  for (const [i, line] of lines.entries()) {
    if (i === 0 && dropFirstLine) continue;
    if (!line.startsWith("{")) continue;
    let level: unknown;
    try {
      level = (JSON.parse(line) as { level?: unknown }).level;
    } catch {
      continue;
    }
    if (typeof level !== "number") continue;
    if (level >= 50) errors++;
    else if (level === 40) warns++;
  }
  return { errors, warns };
}

/** The Claude Code config dir: CLAUDE_CONFIG_DIR override, else ~/.claude. */
function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

/** Read a JSON file, or null on any failure (absent/unreadable/unparseable). */
function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/** caret's id in Claude Code's plugin registry: `<plugin>@<marketplace>`, both
 * "caret" per scripts/install.sh. */
const PLUGIN_ID = "caret@caret";

/** Best-effort read of caret's Claude Code install state. Every miss degrades
 * to "unknown". Reads ONLY caret's own entries — never any other settings key
 * (privacy). hookInUserSettings is the NORMAL-false probe: caret's hooks ride
 * inside the plugin's own hooks.json, so a user-settings hook means a MANUAL
 * entry; false when settings parse but hold none, "unknown" when unreadable. */
export function readClaudeInstallState(): ClaudeInstallState {
  const dir = claudeConfigDir();
  return {
    pluginVersion: readPluginVersion(join(dir, "plugins", "installed_plugins.json")),
    pluginEnabled: readPluginEnabled(join(dir, "settings.json")),
    hookInUserSettings: readHookInUserSettings(join(dir, "settings.json")),
  };
}

function readPluginVersion(path: string): string | "unknown" {
  const json = readJson(path) as { plugins?: Record<string, unknown> } | null;
  const entry = json?.plugins?.[PLUGIN_ID];
  if (!Array.isArray(entry) || entry.length === 0) return "unknown";
  const version = (entry[0] as { version?: unknown }).version;
  return typeof version === "string" ? version : "unknown";
}

function readPluginEnabled(path: string): boolean | "unknown" {
  const json = readJson(path) as { enabledPlugins?: Record<string, unknown> } | null;
  if (!json) return "unknown";
  const enabled = json.enabledPlugins?.[PLUGIN_ID];
  return typeof enabled === "boolean" ? enabled : "unknown";
}

function readHookInUserSettings(path: string): boolean | "unknown" {
  const json = readJson(path) as { hooks?: Record<string, unknown> } | null;
  if (!json) return "unknown";
  const hooks = json.hooks;
  if (hooks === undefined || hooks === null || typeof hooks !== "object") return false;
  // Walk every event array → every matcher → its hooks[].command, hunting a
  // manual caret hook entry. Defensive at each hop: a malformed shape just
  // yields no match (false), never a throw.
  for (const eventEntry of Object.values(hooks as Record<string, unknown>)) {
    if (!Array.isArray(eventEntry)) continue;
    for (const matcher of eventEntry) {
      const inner = (matcher as { hooks?: unknown })?.hooks;
      if (!Array.isArray(inner)) continue;
      for (const h of inner) {
        const command = (h as { command?: unknown })?.command;
        if (
          typeof command === "string" &&
          (command.includes("caret review") || command.includes("caret prewarm"))
        ) {
          return true;
        }
      }
    }
  }
  return false;
}
