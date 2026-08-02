// caret's OpenCode plugin (EXC-339). OpenCode is plugin-shaped, not command-hook
// shaped: it loads this in-process module and lets it register tools and mutate
// config. caret has no native plan-approval gate to intercept here (OpenCode has
// no ExitPlanMode equivalent), so this plugin REGISTERS its own plan-review tool,
// steers the Plan agent to call it, and
// runs the review synchronously inside the tool's execute(): it spawns
// `caret review` (CARET_AGENT=opencode) with a caret-defined envelope on stdin,
// blocks until the human decides in caret's browser UI, and returns the approval
// or change-request string as the tool result. The whole caret daemon/review
// pipeline is reused unchanged — this plugin is the OpenCode-side counterpart to
// Claude Code's hooks.json, which likewise spawns `caret review`.
//
// Subagent-bypass mitigation: OpenCode's tool.execute.before does not fire for
// subagent tool calls, so caret does NOT rely on a hook to gate subagents. The
// config hook marks the tool primary-only (experimental.primary_tools), which
// OpenCode turns into a deny rule on every subagent session it creates, and the
// tool body re-checks the calling session's shape — defense in depth. Any PRIMARY
// agent may ask for a review; only the plan agent is steered toward it.
//
// This file runs in-process inside OpenCode. It ships in the @macintacos/caret npm
// package; OpenCode loads it when the package is in the user's `plugin` array, and
// it resolves its own binary and version at runtime from that package. (The legacy
// file-deploy path substitutes the two __CARET_*__ markers instead.) It stays
// self-contained: its only imports are node builtins (child_process, fs, url) and
// @opencode-ai/plugin (resolved by OpenCode at runtime). Live in-OpenCode
// verification of the exact ctx/tool/config shapes against the installed OpenCode
// version is a documented follow-up; the pure logic below is covered by
// test/opencode/.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { type Hooks, type Plugin, tool } from "@opencode-ai/plugin";

/** Install-time markers. The legacy file-deploy path substituted these with the
 * resolved caret version and binary path; the array install leaves them as
 * placeholders, so the resolvers below fall back to the package that ships this
 * file. */
export const CARET_PLUGIN_VERSION = "__CARET_VERSION__";
const CARET_BIN = "__CARET_BIN__";

/** The caret binary the review tool spawns. Env override wins; then a substituted
 * marker (an absolute path, from the legacy file-deploy path); else the binary that
 * ships beside this module in the npm package (the array install). */
export function resolveCaretBin(opts: {
  env: Record<string, string | undefined>;
  marker: string;
  importMetaUrl: string;
}): string {
  const override = opts.env.CARET_OPENCODE_BIN?.trim();
  if (override) return override;
  if (opts.marker !== "__CARET_BIN__") return opts.marker;
  return fileURLToPath(new URL("../bin/caret", opts.importMetaUrl));
}

/** The plugin's own caret version, for the update check. A substituted marker wins
 * (file-deploy); else read it from the package.json shipped beside this module (the
 * array install). "unknown" when neither is available — deliberately UNPARSEABLE so
 * `isNewer` compares false and a broken read stays silent ("0.0.0" would parse and
 * nag "update available (you have 0.0.0)" on every start). */
export function resolveCaretVersion(opts: {
  marker: string;
  importMetaUrl: string;
  readFile: (path: string) => string;
}): string {
  if (opts.marker !== "__CARET_VERSION__") return opts.marker;
  try {
    const raw = opts.readFile(fileURLToPath(new URL("../package.json", opts.importMetaUrl)));
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === "string" ? v : "unknown";
  } catch {
    return "unknown";
  }
}

/** The plan-review tool the Plan agent calls. */
export const REVIEW_TOOL = "caret_review_plan";

/** OpenCode's built-in primary planning agent — the one agent caret steers toward
 * the review tool and warms the daemon for. */
export const PLANNING_AGENTS = ["plan"] as const;

export interface CaretDecision {
  behavior: "allow" | "deny";
  feedback?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/** The first markdown heading in the plan, used as the review title — or
 * undefined when the plan has no `# ` heading. */
export function planTitle(plan: string): string | undefined {
  for (const line of plan.split("\n")) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

/** Build the caret review envelope `caret review` (CARET_AGENT=opencode) parses.
 * Mirrors the snake_case session/cwd shape the opencode adapter's parseHookInput
 * reads — both ends are caret-owned. */
export function buildEnvelope(
  plan: string,
  ctx: { sessionID?: string; directory?: string },
): string {
  return JSON.stringify({
    session_id: ctx.sessionID,
    cwd: ctx.directory,
    tool_input: { plan, title: planTitle(plan) },
  });
}

/** Parse the single decision JSON line `caret review` prints on stdout. Fail-safe:
 * anything unrecognized or unparseable becomes a deny — shipping an unreviewed
 * plan is the one outcome caret never allows. */
export function parseDecision(stdout: string): CaretDecision {
  const line =
    stdout
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .at(-1) ?? "";
  try {
    const d = JSON.parse(line) as { behavior?: unknown; feedback?: unknown };
    if (d.behavior === "allow") {
      // Reviewer notes (EXC-791) ride the allow; surface them to the agent below.
      const notes = typeof d.feedback === "string" ? d.feedback.trim() : "";
      return notes ? { behavior: "allow", feedback: notes } : { behavior: "allow" };
    }
    if (d.behavior === "deny") {
      return {
        behavior: "deny",
        feedback: typeof d.feedback === "string" ? d.feedback : "Plan changes requested.",
      };
    }
    return failsafeDeny("caret: unrecognized review decision — denying to fail safe.");
  } catch {
    return failsafeDeny("caret: could not parse the review decision — denying to fail safe.");
  }
}

function failsafeDeny(feedback: string): CaretDecision {
  return { behavior: "deny", feedback };
}

/** True for the planning agent(s) caret treats specially — the planning steer and
 * the daemon warm-up both fire only for them. Not a permission check: the review
 * tool itself is open to every primary agent. */
export function isPlanningAgent(agent: string | undefined): boolean {
  return agent !== undefined && (PLANNING_AGENTS as readonly string[]).includes(agent);
}

/** Tool result returned to the agent on approval. Optional reviewer notes
 * (EXC-791) are folded in as a clearly-labeled section the agent incorporates as
 * it implements — the plan is already approved, so no re-planning round. The
 * OpenCode agent holds the plan in its own tool args (there is no plan file to
 * append to), so this tool result is the delivery channel. */
export function approvedMessage(notes?: string): string {
  const base = "caret: the user APPROVED this plan. Proceed with the implementation as planned.";
  const trimmed = notes?.trim();
  if (!trimmed) return base;
  return [
    "caret: the user APPROVED this plan.",
    "",
    "They added notes to fold into your work — incorporate them as you implement; no need to re-plan:",
    "",
    "## Notes from the user",
    "",
    trimmed,
    "",
    "Proceed with the implementation.",
  ].join("\n");
}

/** Tool result returned to the agent on a change request: the reviewer feedback
 * and a resubmit instruction. The plan itself is NOT echoed — the agent already
 * has it in its own `caret_review_plan` tool-call args, so re-pasting the full
 * plan every round is redundant. The feedback's line references index caret's
 * STORED plan version, rumdl-reflowed to 90 columns at ingest
 * (src/plan/markdown.ts), so they do not resolve against the agent's copy; the
 * abbreviated quote paired with each one (see `abbreviate` in
 * ui/src/lib/feedback.ts) is what the agent matches against its own text. */
export function deniedMessage(feedback: string): string {
  return [
    "caret: the user requested CHANGES to this plan.",
    "",
    "Feedback:",
    feedback,
    "",
    `Revise the plan accordingly, then call \`${REVIEW_TOOL}\` again with the updated plan.`,
  ].join("\n");
}

/** Extract caret's review URL from the child's stderr text. Core writes
 * `caret: review this plan at <url>\n` (src/review/orchestrate.ts); both ends are caret-owned,
 * so this regex is coupled to that one line by design. The trailing `\s` match
 * means a stderr chunk cut off mid-URL (before the newline) yields nothing rather
 * than a truncated URL — the match only fires once the whole line has arrived. */
export function parseReviewUrl(stderr: string): string | undefined {
  return stderr.match(/caret: review this plan at (\S+)\s/)?.[1];
}

/** The label caret puts in the review toast's TITLE. The review URL goes in the
 * toast MESSAGE (on its own line), not concatenated after this — OpenCode's toast
 * word-wraps, and a URL sharing a line with this prefix breaks across the wrap and
 * stops being terminal-clickable. Title + message-alone keeps the (short) URL whole
 * on its own full-width line (EXC-691). caret owns this toast surface because
 * OpenCode renders `caret_review_plan` as a generic tool whose running state never
 * shows the tool's `metadata` title. */
const REVIEW_TOAST_TITLE = "caret: review this plan";

/** OpenCode's plugin client, structurally narrowed to the calls caret makes.
 * A structural type (rather than importing the SDK client) keeps this robust
 * against version skew between the pinned plugin SDK and the running OpenCode. */
type ToastBody = {
  title?: string;
  message: string;
  variant: "info" | "success" | "warning" | "error";
  duration?: number;
};
type ToastClient = { tui?: { showToast?: (opts: { body: ToastBody }) => unknown } } | undefined;

/** The same client, narrowed to the session read the review tool's subagent check
 * makes — narrowed separately, and for the same skew-safety reason, so each helper
 * declares exactly the one call it performs. */
type SessionClient =
  | { session?: { get?: (opts: { path: { id: string } }) => unknown } }
  | undefined;

/** What OpenCode actually hands the plugin: both narrowings at once. */
type CaretClient = NonNullable<ToastClient> & NonNullable<SessionClient>;

/** How long the pending review-link toast stays up. Long enough to outlast a
 * review; on a decision we supersede it with the short toast below, so this
 * ceiling only bites if the review process dies without ever deciding. */
const REVIEW_TOAST_MS = 10 * 60_000;
/** The brief decision toast that supersedes (and thereby clears) the review-link
 * toast, since OpenCode's single-slot toast surface has no hide API. */
const DECISION_TOAST_MS = 4_000;

/** Best-effort toast: surfacing or clearing the review link must never crash or
 * delay the review. Swallows a missing method (SDK skew) and any sync throw or
 * async rejection. Called as `tui.showToast(...)` so the SDK client keeps its
 * `this` binding. */
function showToast(client: ToastClient, body: ToastBody): void {
  const tui = client?.tui;
  if (!tui || typeof tui.showToast !== "function") return;
  try {
    Promise.resolve(tui.showToast({ body })).catch(() => {});
  } catch {
    // best-effort — the review decision is what matters.
  }
}

/** True when this tool call arrived from a subagent — a `parentID` on the calling
 * session, which OpenCode's `task` tool always sets and an agent-name test cannot
 * see. Failure falls back to ALLOW, deliberately inverting this file's failsafeDeny
 * convention; both choices are argued in `doc/agents/opencode-integration.md` § The
 * subagent bypass. Not raced against a timeout: the call is loopback to OpenCode's
 * own server, so a hang is out of scope. Called as `session.get(...)` so the SDK
 * client keeps its `this` binding. */
async function isSubagentSession(client: SessionClient, sessionID: string): Promise<boolean> {
  const session = client?.session;
  if (!session || typeof session.get !== "function") return false;
  try {
    const res = (await session.get({ path: { id: sessionID } })) as {
      data?: { parentID?: unknown } | null;
    };
    return typeof res?.data?.parentID === "string";
  } catch {
    return false;
  }
}

// --- version-check toast (EXC-794) -----------------------------------------

/** caret's latest-release endpoint. Unauthenticated GitHub API — throttled to at
 * most once a day (see UPDATE_CHECK_INTERVAL_MS), so it never approaches the
 * 60 req/hr/IP limit. */
const LATEST_RELEASE_URL = "https://api.github.com/repos/macintacos/caret/releases/latest";
/** How long the update nudge stays up — long enough to read the link. */
const UPDATE_TOAST_MS = 5_000;
/** Minimum gap between update checks. The nudge is a convenience, not a security
 * fix, so checking once a day is plenty — and it keeps the network hit off every
 * OpenCode start. The last-check time is persisted in a small throttle file. */
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60_000;

/** Semver triple `[major, minor, patch]`, or null when `v` is not `X.Y.Z` (an
 * optional leading `v` is stripped; trailing prerelease/build metadata ignored). */
function parseVersionTriple(v: string): [number, number, number] | null {
  const m = v
    .trim()
    .replace(/^v/, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `latest` is a strictly higher semver than `current`. Inline (no semver
 * dep) so the deployed plugin stays self-contained; an unparseable version on
 * either side compares false, so the check never nags on something it can't read. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersionTriple(latest);
  const b = parseVersionTriple(current);
  if (!a || !b) return false;
  const [a0, a1, a2] = a;
  const [b0, b1, b2] = b;
  if (a0 !== b0) return a0 > b0;
  if (a1 !== b1) return a1 > b1;
  return a2 > b2;
}

/** The version (v-stripped) and release-page URL from GitHub's /releases/latest
 * JSON, or null when the shape is unusable. */
export function parseLatestRelease(json: unknown): { version: string; url: string } | null {
  if (typeof json !== "object" || json === null) return null;
  const o = json as { tag_name?: unknown; html_url?: unknown };
  if (typeof o.tag_name !== "string") return null;
  const url =
    typeof o.html_url === "string"
      ? o.html_url
      : "https://github.com/macintacos/caret/releases/latest";
  return { version: o.tag_name.replace(/^v/, ""), url };
}

/** The update-available toast body, or null when the user is already current. */
export function updateToastBody(
  current: string,
  latest: { version: string; url: string },
): ToastBody | null {
  if (!isNewer(latest.version, current)) return null;
  return {
    title: "caret update available",
    message: `caret ${latest.version} is available (you have ${current}). ${latest.url}`,
    variant: "info",
    duration: UPDATE_TOAST_MS,
  };
}

/** The slice of `fetch` the update check needs — narrow so a test can pass a plain
 * stub without reconstructing `fetch`'s `preconnect` sibling. The global `fetch`
 * (and Bun's) is assignable to it. */
type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** True when the last check is old enough (or absent) to check again. Pure so the
 * 24h throttle is unit-testable without a clock or the filesystem. */
export function shouldCheckForUpdate(lastCheckMs: number | null, nowMs: number): boolean {
  return lastCheckMs === null || nowMs - lastCheckMs >= UPDATE_CHECK_INTERVAL_MS;
}

/** Absolute path of the throttle file holding the last-check epoch-ms. Lives under
 * caret's state dir ($XDG_STATE_HOME/caret or ~/.local/state/caret), matching where
 * caret keeps its other small machine-global markers (prefs.json). Pure so the
 * location is testable; the plugin stays self-contained and cannot import
 * src/config/paths.ts, so the convention is mirrored here by hand. */
export function updateCheckCachePath(
  env: Record<string, string | undefined>,
  home: string,
): string {
  const base = env.XDG_STATE_HOME?.trim() || `${home}/.local/state`;
  return `${base}/caret/opencode-update-check`;
}

/** The throttle seam: read the last-check epoch-ms (null when never / unreadable),
 * and persist a new one. Injected so realUpdateChecker's throttle is testable
 * without touching disk. */
type UpdateCache = { read: () => number | null; write: (epochMs: number) => void };

/** File-backed UpdateCache. Read tolerates a missing or garbage file (→ null, so
 * the check runs); write is best-effort — a failure just means we check again next
 * start rather than crashing plugin load. */
function fileUpdateCache(path: string): UpdateCache {
  return {
    read: () => {
      try {
        const n = Number.parseInt(readFileSync(path, "utf-8").trim(), 10);
        return Number.isFinite(n) ? n : null;
      } catch {
        return null;
      }
    },
    write: (epochMs) => {
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, String(epochMs));
      } catch {
        // best-effort — a throttle-file write must never disrupt load.
      }
    },
  };
}

/** Best-effort startup update check: fetch caret's latest GitHub release and, if it
 * is newer than this plugin's version, toast a nudge with a link. Throttled to at
 * most once a day via the injected cache — the check time is stamped up front, so
 * even an offline/failed start backs off a full day rather than hitting the network
 * on every restart. Never throws and never blocks plugin load — a network error, a
 * non-200, an unusable body, the throttle, or the `CARET_OPENCODE_NO_UPDATE_CHECK`
 * opt-out all resolve silently. `fetchImpl`/`url`/`now`/`cache` are injected so it is
 * unit-testable without the network or the filesystem. */
export async function realUpdateChecker(
  client: ToastClient,
  opts: {
    currentVersion: string;
    env: Record<string, string | undefined>;
    fetchImpl: FetchLike;
    now: () => number;
    cache: UpdateCache;
    url?: string;
  },
): Promise<void> {
  if (opts.env.CARET_OPENCODE_NO_UPDATE_CHECK) return;
  const nowMs = opts.now();
  if (!shouldCheckForUpdate(opts.cache.read(), nowMs)) return;
  // Stamp the check up front so a failed/offline check still backs off a day.
  opts.cache.write(nowMs);
  try {
    const res = await opts.fetchImpl(opts.url ?? LATEST_RELEASE_URL, {
      headers: { "user-agent": "caret-opencode-plugin", accept: "application/vnd.github+json" },
    });
    if (!res.ok) return;
    const latest = parseLatestRelease(await res.json());
    if (!latest) return;
    const body = updateToastBody(opts.currentVersion, latest);
    if (body) showToast(client, body);
  } catch {
    // best-effort — an update nudge must never disrupt the session.
  }
}

/** The planning-prompt steer appended to the system array so the Plan agent
 * submits its plan to caret instead of calling the native plan_exit. */
export function planningSteer(): string {
  return [
    "## Plan review (caret)",
    "",
    `When you have a plan ready for the user, do NOT call plan_exit. Instead call the \`${REVIEW_TOOL}\` tool with your full plan (markdown) as the \`plan\` argument.`,
    "It opens caret's visual review UI in the browser; the user approves or requests changes. Any change request comes back as the tool result — revise the plan and call the tool again until it is approved.",
  ].join("\n");
}

// --- config-hook mutation (subagent-bypass mitigation) -------------------------

type LooseAgent = { mode?: string; permission?: unknown } & Record<string, unknown>;
type LooseConfig = {
  experimental?: { primary_tools?: string[] } & Record<string, unknown>;
  agent?: Record<string, LooseAgent>;
} & Record<string, unknown>;

/** Mutate the OpenCode config in place to mark the review tool primary-only, so
 * subagents cannot call it. Every primary agent may call it — OpenCode's base
 * ruleset permits an unknown tool id, so the absence of a per-agent entry is what
 * makes it available. The mechanism and the reasoning are in
 * `doc/agents/opencode-integration.md` § The subagent bypass.
 *
 * Idempotent and preservation-safe: existing primary_tools, agent modes, and other
 * permissions survive, as does a user's own entry for the review tool. */
export function applyCaretConfig(config: LooseConfig): void {
  config.experimental ??= {};
  const pt = Array.isArray(config.experimental.primary_tools)
    ? config.experimental.primary_tools
    : [];
  if (!pt.includes(REVIEW_TOOL)) config.experimental.primary_tools = [...pt, REVIEW_TOOL];

  for (const name of PLANNING_AGENTS) {
    // The plan agent is the one that depends on the tool, so rescue it from a
    // restrictive global `permission: { "*": "deny" }` — agent-level permission
    // merges after the global ruleset. Written only when the agent has no entry for
    // this tool id: a `"*"` catch-all is deliberately overridden, an explicit entry
    // for the tool is not.
    ensurePermission(ensureAgent(config, name))[REVIEW_TOOL] ??= "allow";
  }
}

function ensureAgent(config: LooseConfig, name: string): LooseAgent {
  config.agent ??= {};
  config.agent[name] ??= {};
  return config.agent[name];
}

/** Return the agent's permission map, normalizing the two degenerate shapes
 * OpenCode allows — a bare action string (preserved as a `"*"` catch-all) or an
 * absent/non-object value — so the assignment below never corrupts it. */
function ensurePermission(agent: LooseAgent): Record<string, unknown> {
  const p = agent.permission;
  if (typeof p === "string") agent.permission = { "*": p };
  else if (typeof p !== "object" || p === null) agent.permission = {};
  return agent.permission as Record<string, unknown>;
}

// --- the spawn bridge ----------------------------------------------------------

/** Runs `caret review`, returning its captured stdout. Injected so execute() is
 * unit-testable without spawning a real process. `onStderr` streams the child's
 * stderr chunks as they arrive, so the caller can surface the review URL the core
 * prints there while the review is still pending. */
export type SpawnRunner = (
  bin: string,
  env: Record<string, string | undefined>,
  stdin: string,
  onStderr?: (chunk: string) => void,
) => Promise<{ stdout: string; exitCode: number }>;

/** Spawn `caret review` with the review envelope on stdin and CARET_AGENT=opencode,
 * then parse its decision line. Any spawn failure fails safe to a deny. `onUrl`, if
 * given, fires once with the review URL the moment core prints it on stderr — the
 * caller surfaces it inside the tool block so it clears on decision (EXC-691). */
export async function runReviewViaCaret(
  envelope: string,
  opts: { bin: string; run: SpawnRunner; onUrl?: (url: string) => void },
): Promise<CaretDecision> {
  try {
    // Accumulate stderr and report the URL once — the line may arrive split
    // across chunks, and only the first occurrence matters.
    const { onUrl } = opts;
    let stderrBuf = "";
    let urlSent = false;
    const onStderr = onUrl
      ? (chunk: string) => {
          if (urlSent) return;
          stderrBuf += chunk;
          const url = parseReviewUrl(stderrBuf);
          if (url) {
            urlSent = true;
            // Best-effort: surfacing the URL must never crash or fail-safe-deny
            // the review. This fires on the stderr `data` event while we're
            // suspended at `await opts.run(...)`, so a throw here would escape the
            // try/catch below as an uncaughtException rather than a deny.
            try {
              onUrl(url);
            } catch {
              // swallow — the review decision is what matters.
            }
          }
        }
      : undefined;
    const { stdout } = await opts.run(
      opts.bin,
      { ...process.env, CARET_AGENT: "opencode" },
      envelope,
      onStderr,
    );
    return parseDecision(stdout);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return failsafeDeny(`caret: review failed to run (${message}) — denying to fail safe.`);
  }
}

/** Production runner: spawn the caret binary's `review` subcommand. stderr is
 * PIPED (not inherited) and streamed to `onStderr`: inheriting it leaked core's
 * "review this plan at <url>" line straight into OpenCode's TUI scrollback, where
 * the renderer never owns it and it lingered after the decision (EXC-691). We now
 * parse that URL and surface it as a caret-owned toast instead; the child logs
 * diagnostics to caret.log, so dropping the rest of stderr loses nothing. */
const nodeSpawnRunner: SpawnRunner = (bin, env, stdin, onStderr) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, ["review"], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => onStderr?.(chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, exitCode: code ?? 0 }));
    child.stdin.write(stdin);
    child.stdin.end();
  });

/** Warms the caret daemon ahead of a review. Injected so the chat.message hook is
 * unit-testable without spawning a process. */
export type WarmRunner = (bin: string) => void;

/** Production warm: `caret prewarm`, detached and unref'd so it never holds up the
 * turn. Output is discarded — the child logs to caret.log. Two non-obvious
 * requirements, both spelled out in `doc/agents/opencode-integration.md` § Daemon
 * warm-up: CARET_AGENT rides along because this spawn is what stands the daemon
 * up and the daemon picks its adapter from that env; and the 'error' handler is
 * mandatory because spawn emits 'error' ASYNCHRONOUSLY (ENOENT on a bad bin),
 * where the hook's synchronous try/catch cannot see it and an unhandled event
 * would take OpenCode's whole process down. */
const nodeWarmRunner: WarmRunner = (bin) => {
  const child = spawn(bin, ["prewarm"], {
    stdio: "ignore",
    detached: true,
    env: { ...process.env, CARET_AGENT: "opencode" },
  });
  child.on("error", () => {});
  child.unref();
};

// ---------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------

/** Build the caret OpenCode plugin. The DI seam (bin/run/warm/checkUpdate) keeps
 * the tool's execute(), the daemon warm, and the startup update check
 * unit-testable; the default export wires the production runners and update
 * checker. */
export function createCaretPlugin(
  opts: {
    bin?: string;
    run?: SpawnRunner;
    warm?: WarmRunner;
    checkUpdate?: (client: ToastClient) => void;
  } = {},
): Plugin {
  const bin =
    opts.bin ??
    resolveCaretBin({ env: process.env, marker: CARET_BIN, importMetaUrl: import.meta.url });
  const run = opts.run ?? nodeSpawnRunner;
  const warm = opts.warm ?? nodeWarmRunner;

  return async (input) => {
    // OpenCode gives every plugin its SDK client; caret uses it to surface the
    // review link as a toast (EXC-691) and to read the calling session's shape.
    // Narrowed structurally for skew-safety.
    const client = (input as { client?: CaretClient }).client;
    // Best-effort startup update nudge (EXC-794); fire-and-forget so it never
    // delays plugin load. Only the production default export wires this.
    if (opts.checkUpdate) opts.checkUpdate(client);
    // The agent driving each session, recorded by chat.message and read by
    // system.transform, which carries no agent of its own. Why a map is the only
    // route: `doc/agents/opencode-integration.md` § Why gating the steer needs a
    // session→agent map. One instance per plugin, closed over rather than
    // module-global, so a test constructs a fresh one.
    const sessionAgents = new Map<string, string>();
    const hooks: Hooks = {
      // Restrict the review tool to primary agents (see applyCaretConfig).
      config: async (config) => {
        applyCaretConfig(config as unknown as LooseConfig);
      },
      // Two jobs. (1) Record the session's agent, ALWAYS — it is what the steer
      // below gates on. (2) Warm the daemon, for the PLAN AGENT ONLY, so the first
      // caret_review_plan call doesn't pay the cold-spawn cost. This is
      // OpenCode's counterpart to Claude Code's PostToolUse/EnterPlanMode
      // prewarm hook — the closest-to-submission signal the plugin API offers.
      // Deliberately per-message and unthrottled: the daemon idle-exits after
      // [daemon].idle_ms (60s default), so a once-per-session warm would be
      // dead long before the plan lands. The warm stays plan-only even though any
      // primary agent may call the tool: the plan agent is the one whose turn
      // reliably ends in a review, and warming on every build message would spawn
      // a process on the session's busiest traffic to save ~0.4s in the rare case.
      "chat.message": async (input) => {
        // A message whose agent is unknown must not clobber the recorded one.
        if (input.sessionID && input.agent) sessionAgents.set(input.sessionID, input.agent);
        if (!isPlanningAgent(input.agent)) return;
        try {
          warm(bin);
        } catch {
          // best-effort — the review path spawns the daemon itself if this missed.
        }
      },
      // Steer the Plan agent to submit its plan to caret instead of plan_exit.
      // Only the plan agent: every other primary agent may call the review tool
      // but is not prompted toward it. A session with no recorded agent gets no
      // steer rather than a wrong one — which also keeps it out of the second
      // call site (Agent.generate, generating an agent config, passes no session).
      // A turn that reaches the model without a preceding chat.message therefore
      // misses the steer; the tool.definition hook below is the safety net, since
      // it points plan_exit — permitted only on the plan agent — at caret.
      "experimental.chat.system.transform": async (input, output) => {
        const agent = input.sessionID ? sessionAgents.get(input.sessionID) : undefined;
        if (isPlanningAgent(agent)) output.system.push(planningSteer());
      },
      // Redirect the native plan_exit tool's description toward caret's tool.
      "tool.definition": async (input, output) => {
        if (input.toolID === "plan_exit") {
          output.description = `Do not call this tool. Call ${REVIEW_TOOL} instead — it opens caret's visual plan-review UI for human approval.`;
        }
      },
      tool: {
        [REVIEW_TOOL]: tool({
          description:
            "Submit the current plan to caret for human review in a local browser UI. Blocks until the user approves or requests changes. On a change request, revise the plan and call this tool again with the updated plan.",
          args: {
            plan: tool.schema
              .string()
              .describe("The complete plan, as markdown, to present for human review."),
          },
          async execute(args, context) {
            if (await isSubagentSession(client, context.sessionID)) {
              return `${REVIEW_TOOL} is available to primary agents only; this call came from a subagent session. Continue without caret review, or hand the plan back to the primary agent to submit.`;
            }
            const envelope = buildEnvelope(args.plan, {
              sessionID: context.sessionID,
              directory: context.directory,
            });
            let linkShown = false;
            const decision = await runReviewViaCaret(envelope, {
              bin,
              run,
              // Show the review URL as a toast while the plan is pending. The URL
              // is the message ALONE (label in the title) so it renders on its own
              // full-width line and word-wraps whole, staying clickable (EXC-691).
              onUrl: (url) => {
                linkShown = true;
                showToast(client, {
                  title: REVIEW_TOAST_TITLE,
                  message: url,
                  variant: "info",
                  duration: REVIEW_TOAST_MS,
                });
              },
            });
            // Clear the pending review-link toast on decision by superseding it
            // with a brief decision toast — OpenCode's toast surface is single-slot
            // with no hide API, so a fresh toast replaces the link (EXC-691).
            if (linkShown) {
              showToast(
                client,
                decision.behavior === "allow"
                  ? {
                      message: "caret: plan approved",
                      variant: "success",
                      duration: DECISION_TOAST_MS,
                    }
                  : {
                      message: "caret: changes requested",
                      variant: "info",
                      duration: DECISION_TOAST_MS,
                    },
              );
            }
            return decision.behavior === "allow"
              ? approvedMessage(decision.feedback)
              : deniedMessage(decision.feedback ?? "Plan changes requested.");
          },
        }),
      },
    };
    return hooks;
  };
}

/** The plugin OpenCode loads (bare default-export function). Wires the production
 * update checker: on load, check caret's latest release and toast if behind. */
const CaretPlugin: Plugin = createCaretPlugin({
  checkUpdate: (client) => {
    void realUpdateChecker(client, {
      currentVersion: resolveCaretVersion({
        marker: CARET_PLUGIN_VERSION,
        importMetaUrl: import.meta.url,
        readFile: (p) => readFileSync(p, "utf-8"),
      }),
      env: process.env,
      fetchImpl: fetch,
      now: () => Date.now(),
      cache: fileUpdateCache(updateCheckCachePath(process.env, homedir())),
    });
  },
});
export default CaretPlugin;
