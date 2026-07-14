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
// config hook restricts the tool to primary agents (experimental.primary_tools +
// per-agent permission), and the tool body re-checks the caller — defense in depth.
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
import { readFileSync } from "node:fs";
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
 * the review tool and allows to call it. */
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
    if (d.behavior === "allow") return { behavior: "allow" };
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

/** Only the configured planning agent(s) may call the review tool — the second
 * line of defense against the subagent-bypass (the config hook is the first). */
export function isPlanningAgent(agent: string | undefined): boolean {
  return agent !== undefined && (PLANNING_AGENTS as readonly string[]).includes(agent);
}

/** Tool result returned to the agent on approval. */
export function approvedMessage(): string {
  return "caret: the user APPROVED this plan. Proceed with the implementation as planned.";
}

/** Tool result returned to the agent on a change request: the reviewer feedback
 * and a resubmit instruction. The plan itself is NOT echoed — the agent already
 * has it in its own `caret_review_plan` tool-call args, and the feedback's line
 * references + abbreviated quotes resolve against that copy (see `abbreviate` in
 * ui/src/lib/feedback.ts), so re-pasting the full plan every round is redundant. */
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
 * `caret: review this plan at <url>\n` (src/review.ts); both ends are caret-owned,
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

/** OpenCode's plugin client, structurally narrowed to the one call caret makes.
 * A structural type (rather than importing the SDK client) keeps this robust
 * against version skew between the pinned plugin SDK and the running OpenCode. */
type ToastBody = {
  title?: string;
  message: string;
  variant: "info" | "success" | "warning" | "error";
  duration?: number;
};
type ToastClient = { tui?: { showToast?: (opts: { body: ToastBody }) => unknown } } | undefined;

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

// --- version-check toast (EXC-794) -----------------------------------------

/** caret's latest-release endpoint. Unauthenticated GitHub API (60 req/hr/IP is
 * ample for one check per OpenCode start, so no cache). */
const LATEST_RELEASE_URL = "https://api.github.com/repos/macintacos/caret/releases/latest";
/** How long the update nudge stays up — long enough to read the link. */
const UPDATE_TOAST_MS = 12_000;

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

/** Best-effort startup update check: fetch caret's latest GitHub release and, if it
 * is newer than this plugin's version, toast a nudge with a link. Never throws and
 * never blocks plugin load — a network error, a non-200, an unusable body, or the
 * `CARET_OPENCODE_NO_UPDATE_CHECK` opt-out all resolve silently. `fetchImpl`/`url`
 * are injected so it is unit-testable without the network. */
export async function realUpdateChecker(
  client: ToastClient,
  opts: {
    currentVersion: string;
    env: Record<string, string | undefined>;
    fetchImpl: FetchLike;
    url?: string;
  },
): Promise<void> {
  if (opts.env.CARET_OPENCODE_NO_UPDATE_CHECK) return;
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

/** Mutate the OpenCode config in place to (1) mark the review tool primary-only so
 * subagents cannot call it, and (2) allow it on the planning agent while denying it
 * on the build agent. Idempotent and preservation-safe (existing primary_tools,
 * agent modes, and other permissions are kept). */
export function applyCaretConfig(config: LooseConfig): void {
  config.experimental ??= {};
  const pt = Array.isArray(config.experimental.primary_tools)
    ? config.experimental.primary_tools
    : [];
  if (!pt.includes(REVIEW_TOOL)) config.experimental.primary_tools = [...pt, REVIEW_TOOL];

  for (const name of PLANNING_AGENTS) setToolPermission(config, name, "allow");
  // Deny on the build agent so a non-planning primary can't ship an unreviewed plan.
  setToolPermission(config, "build", "deny");
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

function setToolPermission(config: LooseConfig, agentName: string, action: "allow" | "deny"): void {
  ensurePermission(ensureAgent(config, agentName))[REVIEW_TOOL] = action;
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

// ---------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------

/** Build the caret OpenCode plugin. The DI seam (bin/run/checkUpdate) keeps the
 * tool's execute() and the startup update check unit-testable; the default export
 * wires the production runner and update checker. */
export function createCaretPlugin(
  opts: { bin?: string; run?: SpawnRunner; checkUpdate?: (client: ToastClient) => void } = {},
): Plugin {
  const bin =
    opts.bin ??
    resolveCaretBin({ env: process.env, marker: CARET_BIN, importMetaUrl: import.meta.url });
  const run = opts.run ?? nodeSpawnRunner;

  return async (input) => {
    // OpenCode gives every plugin its SDK client; caret uses it to surface the
    // review link as a toast (EXC-691). Narrowed structurally for skew-safety.
    const client = (input as { client?: ToastClient }).client;
    // Best-effort startup update nudge (EXC-794); fire-and-forget so it never
    // delays plugin load. Only the production default export wires this.
    if (opts.checkUpdate) opts.checkUpdate(client);
    const hooks: Hooks = {
      // Restrict the review tool to primary agents + allow/deny per agent.
      config: async (config) => {
        applyCaretConfig(config as unknown as LooseConfig);
      },
      // Steer the Plan agent to submit its plan to caret instead of plan_exit.
      "experimental.chat.system.transform": async (_input, output) => {
        output.system.push(planningSteer());
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
            const agent = (context as { agent?: string }).agent;
            if (!isPlanningAgent(agent)) {
              return `${REVIEW_TOOL} is restricted to the plan agent (${PLANNING_AGENTS.join(", ")}); it was called by "${agent ?? "unknown"}". Continue without caret review, or switch to the plan agent and resubmit.`;
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
              ? approvedMessage()
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
    });
  },
});
export default CaretPlugin;
