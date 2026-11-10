// caret's host-neutral OpenCode core: runPlanReview, the planning steer, the caret
// version and plans-dir resolution, the warm runner, the toast bodies and tool-call
// metadata keys, and the update check. It re-uses the bridge's tool name, text, binary
// resolution and version comparison.
// caret.plugin.ts (v1), caret.plugin.v2.ts and caret.tui.ts are thin host adapters over
// it. Its imports are node builtins and ../bridge/review-bridge.ts only, so loading it
// never evaluates either host's SDK; test/structure/dependency-placement.test.ts holds it
// there.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildEnvelope,
  type CaretDecision,
  decisionText,
  isNewer,
  PLAN_TITLE_INSTRUCTION,
  REVIEW_TOOL,
  readRegularFile,
  resolvePlanSource,
  runReviewViaCaret,
  type SpawnRunner,
  warmCaret,
} from "../bridge/review-bridge.ts";

export {
  isNewer,
  PLAN_ARG_DESCRIPTION,
  REVIEW_TOOL,
  REVIEW_TOOL_DESCRIPTION,
  resolveCaretBin,
  resolvePlanSource,
} from "../bridge/review-bridge.ts";

/** The plugin's own caret version, for the update check, read from the package.json
 * shipped beside this module. "unknown" when it is unreadable — deliberately UNPARSEABLE
 * so `isNewer` compares false and a broken read stays silent ("0.0.0" would parse and
 * nag "update available (you have 0.0.0)" on every start). */
export function resolveCaretVersion(opts: {
  importMetaUrl: string;
  readFile: (path: string) => string;
}): string {
  try {
    const raw = opts.readFile(fileURLToPath(new URL("../package.json", opts.importMetaUrl)));
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === "string" ? v : "unknown";
  } catch {
    return "unknown";
  }
}

/** OpenCode's built-in primary planning agent — the one agent caret steers toward
 * the review tool and warms the daemon for. */
export const PLANNING_AGENTS = ["plan"] as const;

/** True for the planning agent(s) caret treats specially — the planning steer and
 * the daemon warm-up both fire only for them. Not a permission check: the review
 * tool itself is open to every primary agent. */
export function isPlanningAgent(agent: string | undefined): boolean {
  return agent !== undefined && (PLANNING_AGENTS as readonly string[]).includes(agent);
}

/** The label caret puts in the review toast's TITLE. The review URL goes in the
 * toast MESSAGE alone, not concatenated after this — OpenCode's toast word-wraps,
 * and a URL sharing a line with this prefix breaks across the wrap and stops being
 * terminal-clickable (EXC-691). caret owns this toast surface because OpenCode
 * renders `caret_review_plan` as a generic tool whose running state never shows the
 * tool's `metadata` title. */
const REVIEW_TOAST_TITLE = "caret: review this plan";

/** A toast's content — structurally both v1's `showToast` body and v2's TUI
 * `ToastOptions`. v1 forwards it as-is, so a host-only field (v2's `sessionID`) is
 * added by that host's sink, not here. */
export type ToastBody = {
  title?: string;
  message: string;
  variant: "info" | "success" | "warning" | "error";
  duration?: number;
};

/** Where a host shows a toast: v2's `ctx.ui.toast.show`, or v1's client as its adapter
 * wraps it. A sink may throw or reject, so call it through `toastBestEffort`. */
export type ToastSink = (body: ToastBody) => unknown;

/** Show a toast best-effort: a toast must never crash or delay the review or plugin load,
 * so a sync throw or async rejection is swallowed. */
export function toastBestEffort(show: ToastSink, body: ToastBody): void {
  try {
    Promise.resolve(show(body)).catch(() => {});
  } catch {}
}

/** How long the pending review-link toast stays up. Long enough to outlast a
 * review; on a decision we supersede it with the short toast below, so this
 * ceiling only bites if the review process dies without ever deciding. */
const REVIEW_TOAST_MS = 10 * 60_000;
/** The brief decision toast that supersedes (and thereby clears) the review-link
 * toast, since OpenCode's single-slot toast surface has no hide API. */
const DECISION_TOAST_MS = 4_000;

/** Tool-call metadata keys that carry the review URL and decision from the v2 server
 * half to its TUI half, whose tool events name the call but not the tool. */
export const CARET_URL_KEY = "caretUrl";
export const CARET_DECISION_KEY = "caretDecision";

export function reviewLinkToast(url: string): ToastBody {
  return { title: REVIEW_TOAST_TITLE, message: url, variant: "info", duration: REVIEW_TOAST_MS };
}

export type ReviewOutcome = CaretDecision["behavior"] | "cancelled";

/** The toast that supersedes the review link. */
export function decisionToast(outcome: ReviewOutcome): ToastBody {
  switch (outcome) {
    case "allow":
      return { message: "caret: plan approved", variant: "success", duration: DECISION_TOAST_MS };
    case "deny":
      return { message: "caret: changes requested", variant: "info", duration: DECISION_TOAST_MS };
    case "cancelled":
      return { message: "caret: review cancelled", variant: "info", duration: DECISION_TOAST_MS };
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
 * OpenCode start. */
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60_000;

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
 * caret's state dir, beside caret's other small machine-global markers (update-check.json).
 * The plugin stays self-contained and cannot import src/config/paths.ts, so that
 * convention is mirrored here by hand. */
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
 * most once a day via the injected cache. Never throws and never blocks plugin load
 * — the `CARET_OPENCODE_NO_UPDATE_CHECK` opt-out and every failure resolve
 * silently. */
export async function realUpdateChecker(
  show: ToastSink,
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
    if (body) toastBestEffort(show, body);
  } catch {
    // best-effort — an update nudge must never disrupt the session.
  }
}

/** Where the planning steer sends the plan agent's plan file: `[opencode] plans_dir`
 * from caret's config.toml (a leading `~` expanded), else `defaultDir`, the host's
 * plan-agent directory, which defaults to OpenCode v1's data-dir `plans/`
 * (`$XDG_DATA_HOME` honoured). The config path mirrors
 * src/config/paths.ts configFile() by hand, since the plugin cannot import src/. */
export function resolvePlansDir(opts: {
  env: Record<string, string | undefined>;
  home: string;
  readFile: (path: string) => string;
  defaultDir?: string;
}): string {
  const configFile =
    opts.env.CARET_CONFIG_FILE ||
    `${opts.env.XDG_CONFIG_HOME || `${opts.home}/.config`}/caret/config.toml`;
  try {
    const config = Bun.TOML.parse(opts.readFile(configFile)) as {
      opencode?: { plans_dir?: unknown };
    };
    const dir = config.opencode?.plans_dir;
    if (typeof dir === "string" && dir) return dir.replace(/^~(?=\/|$)/, opts.home);
  } catch {
    // An absent or malformed config.toml leaves the default.
  }
  return (
    opts.defaultDir ?? `${opts.env.XDG_DATA_HOME || `${opts.home}/.local/share`}/opencode/plans`
  );
}

/** The planning-prompt steer appended to the plan agent's system prompt so it submits
 * its plan to caret rather than ending planning any other way. Worded for both OpenCode
 * v1 (which has plan_exit) and v2 (which does not). */
export function planningSteer(plansDir: string): string {
  return [
    "## Plan review (caret)",
    "",
    `When you have a plan ready for the user, submit it by calling the \`${REVIEW_TOOL}\` tool, not by ending planning any other way (for example with plan_exit). The user asks you to write the plan as markdown to a file in \`${plansDir}/\`, for example \`${plansDir}/<short-name>.md\`, and pass that file as the \`path\` argument. If you may not write that file, pass the plan inline as the \`plan\` argument instead.`,
    "It opens caret's visual review UI in the browser; the user approves or requests changes. A change request comes back as the tool result. With `path`, re-read the file, revise it with targeted edits rather than rewriting it, and call the tool again with the same `path` until it is approved. An approved plan is already saved in that file.",
    PLAN_TITLE_INSTRUCTION,
  ].join("\n");
}

/** Warms the caret daemon ahead of a review. Injected so the chat.message hook is
 * unit-testable without spawning a process. */
export type WarmRunner = (bin: string) => void;

/** Production warm, as the OpenCode adapter. */
export const nodeWarmRunner: WarmRunner = (bin) => warmCaret(bin, "opencode");

export function pathArgDescription(plansDir: string): string {
  return `Preferred. A markdown (.md) file holding the complete plan, absolute or relative to the session directory. (OpenCode's plan agent writes its plan files in ${plansDir}/.)`;
}

export const SUBAGENT_REFUSAL = `${REVIEW_TOOL} is available to primary agents only; this call came from a subagent session. Continue without caret review, or hand the plan back to the primary agent to submit.`;

export function notPermittedToEdit(planFilePath: string, plansDir: string): string {
  return `caret: ${REVIEW_TOOL} was not permitted to edit ${planFilePath}, which a path review rewrites. Write the plan in \`${plansDir}/\` and pass that file as \`path\`, or pass the plan inline as \`plan\`.`;
}

/** What differs per OpenCode host for one review-tool call. */
export type ReviewHost = {
  sessionID: string;
  /** The base a `path` resolves against. */
  directory: string;
  /** Fail-open: false when the session is unreadable. */
  isSubagent: () => Promise<boolean>;
  /** caret rewrites the file and the model chose the path, so OpenCode's own edit rules
   * must allow it. false = denied or the check failed; a string is the host's own
   * refusal, returned instead of the not-permitted text. */
  canEdit: (planFilePath: string) => Promise<boolean | string>;
  /** Aborting it kills the `caret review` child. */
  signal?: AbortSignal;
  /** Fires once with the review URL while the review is pending. */
  onUrl?: (url: string) => void;
  /** Optional approve-variant ids this host can honor, sent as the envelope's
   * `approve_variants`; v1 declares none. */
  approveVariants?: readonly string[];
};

/** One review-tool call, host-neutral: subagent refusal, plan source, the `path` edit
 * check, then `caret review`. `decision` is absent when the call was refused before
 * spawning. */
export async function runPlanReview(
  args: { plan?: string; path?: string },
  host: ReviewHost,
  deps: { bin: string; run: SpawnRunner; plansDir: string },
): Promise<{ text: string; decision?: CaretDecision }> {
  if (await host.isSubagent()) return { text: SUBAGENT_REFUSAL };
  const source = resolvePlanSource(args, host.directory, readRegularFile);
  if ("error" in source) return { text: source.error };
  if (source.planFilePath) {
    const editVerdict = await host.canEdit(source.planFilePath);
    if (typeof editVerdict === "string") return { text: editVerdict };
    if (!editVerdict) return { text: notPermittedToEdit(source.planFilePath, deps.plansDir) };
  }
  const envelope = buildEnvelope(source.plan, {
    sessionID: host.sessionID,
    directory: host.directory,
    planFilePath: source.planFilePath,
    approveVariants: host.approveVariants,
  });
  const decision = await runReviewViaCaret(envelope, {
    command: [deps.bin, "review"],
    agent: "opencode",
    run: deps.run,
    signal: host.signal,
    onUrl: host.onUrl,
  });
  return { text: decisionText(decision, REVIEW_TOOL, source.planFilePath), decision };
}

/** The update check both hosts run, wired to production; one file stamp throttles both. */
export function productionUpdateCheck(show: ToastSink): void {
  void realUpdateChecker(show, {
    currentVersion: resolveCaretVersion({
      importMetaUrl: import.meta.url,
      readFile: (p) => readFileSync(p, "utf-8"),
    }),
    env: process.env,
    fetchImpl: fetch,
    now: () => Date.now(),
    cache: fileUpdateCache(updateCheckCachePath(process.env, homedir())),
  });
}
