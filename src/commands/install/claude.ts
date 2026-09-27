// caret's Claude Code install target. `caret install` registers caret's PUBLISHED plugin
// with Claude Code by driving its CLI: add and refresh caret's marketplace, install and
// enable the plugin, then update it so re-running the installer after a caret upgrade
// also upgrades caret-in-Claude-Code. When Claude's `caret` marketplace is still caret's
// own dev marketplace, it is removed first, since Claude refuses to re-add a name whose
// declared source differs. `--uninstall` removes it.
// With `--from-local` the same CLI installs the LOCAL build instead: the marketplace
// source becomes the generated dev marketplace (see local.ts) rather than the public
// one, and the update phase is skipped — that path reinstalls the dev build directly,
// and an update there would pull the published plugin over it.
// Shelling out to `claude` is injected so the flow is unit-testable, and a missing
// `claude` degrades to reported guidance, never a throw.
//
// The `claude` calls are async (not spawnSync) so the reporter's spinner keeps
// animating while each one runs — a blocked event loop would freeze it mid-frame and
// read as a hang.

import { resolve } from "node:path";

import type { LocalInstall } from "@/commands/install/local.ts";
import { devMarketplaceDir, writeDevMarketplace } from "@/commands/install/local.ts";
import type { InstallUI } from "@/commands/install/ui.ts";
import { silentUI } from "@/commands/install/ui.ts";

/** caret's public marketplace source, the marketplace's registered name, and the
 * `plugin@marketplace` id Claude uses (both the marketplace and the plugin are named
 * `caret`). */
const MARKETPLACE_SOURCE = "macintacos/caret";
const MARKETPLACE_NAME = "caret";
const PLUGIN_REF = "caret@caret";

/** Run a `claude` subcommand. Resolves ok + a failure detail rather than rejecting;
 * `missing: true` means the `claude` CLI wasn't found on PATH. `stdout` is what the
 * command printed, which is how the update phase reads `plugin list --json`. */
export type ClaudeRunner = (
  args: string[],
) => Promise<{ ok: boolean; detail: string; stdout: string; missing?: boolean }>;

/** Production runner: `claude <args>`, output captured. A missing binary is reported
 * as `missing` (so the caller reports install guidance); any other non-zero exit is a
 * reported failure. Never rejects. */
const claudeCli: ClaudeRunner = async (args) => {
  try {
    const proc = Bun.spawn(["claude", ...args], { stdout: "pipe", stderr: "pipe" });
    // Both pipes are drained concurrently with the exit wait: a command that fills one
    // of them would block forever if we awaited the exit first.
    const [code, out, err] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (code === 0) return { ok: true, detail: "", stdout: out };
    return { ok: false, detail: err.trim() || `claude exited ${code}`, stdout: out };
  } catch (e) {
    const missing = e instanceof Error && (e as NodeJS.ErrnoException).code === "ENOENT";
    return { ok: false, missing, detail: e instanceof Error ? e.message : String(e), stdout: "" };
  }
};

/** The version Claude reports for `id` in a `claude plugin list --json` payload — an
 * array of `{ id, version, scope, enabled, … }` entries. A plugin can appear at more than
 * one scope, and the update below targets `--scope user`, so that row wins: reporting a
 * project row's version beside it would describe a plugin the command never touched. Null
 * when the output can't be read (not JSON, an unexpected shape, or no entry for `id`), so
 * the caller degrades to a version-less report rather than failing a good install. */
function parsePluginVersion(stdout: string, id: string): string | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed)) return null;
    const rows = parsed.filter(
      (p): p is { version?: unknown; scope?: unknown } =>
        typeof p === "object" && p !== null && "id" in p && p.id === id,
    );
    const version = (rows.find((p) => p.scope === "user") ?? rows[0])?.version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/** What Claude has registered under caret's marketplace name, from a
 * `claude plugin marketplace list --json` payload: an array of
 * `{ name, source, repo | path | url, installLocation, … }`. */
type CaretMarketplace =
  | { kind: "registered"; source: string; location: string }
  | { kind: "absent" }
  | { kind: "unreadable" };

function readCaretMarketplace(stdout: string): CaretMarketplace {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed)) return { kind: "unreadable" };
    const entry = parsed.find(
      (m): m is { source?: unknown; repo?: unknown; path?: unknown; url?: unknown } =>
        typeof m === "object" && m !== null && "name" in m && m.name === MARKETPLACE_NAME,
    );
    if (!entry) return { kind: "absent" };
    const location = entry.repo ?? entry.path ?? entry.url;
    if (typeof entry.source !== "string" || typeof location !== "string") {
      return { kind: "unreadable" };
    }
    return { kind: "registered", source: entry.source, location };
  } catch {
    return { kind: "unreadable" };
  }
}

const isPublished = (m: CaretMarketplace) =>
  m.kind === "unreadable" ||
  (m.kind === "registered" && m.source === "github" && m.location === MARKETPLACE_SOURCE);

/** Phase 1's warning, from the add's result and the post-add read. */
function registrationWarning(
  add: CommandResults[number] | undefined,
  after: CaretMarketplace,
  handBack: boolean,
): string | null {
  if (isPublished(after)) return null;
  const why = add?.ok === false ? ` (${add.detail})` : "";
  if (after.kind === "registered") {
    return `Claude Code's caret marketplace is ${after.location}, not ${MARKETPLACE_SOURCE}${why}, so the plugin update below reads from it. Run \`claude plugin marketplace remove caret\` and re-run \`caret install\`, or point \`extraKnownMarketplaces.caret\` at ${MARKETPLACE_SOURCE} where your Claude settings are managed.`;
  }
  return handBack
    ? `Could not register ${MARKETPLACE_SOURCE}${why}. Re-run \`caret install\` to retry, or run \`mise run build --install\` to go back to the local build.`
    : `Could not register ${MARKETPLACE_SOURCE}${why}.`;
}

/** The update phase's settled line. `updated` is whether the update command itself
 * landed, and it is load-bearing: when it did not, the two reads are identical, so a line
 * derived from the versions alone would announce "already current" over an install that
 * did not move — the false reassurance this whole command exists to remove. */
function updateLine(before: string | null, after: string | null, updated: boolean): string {
  if (!updated) {
    return before
      ? `caret ${before} in Claude Code — the update did not land`
      : "Could not ask Claude Code for the latest caret";
  }
  if (!before || !after) return "Asked Claude Code for the latest caret — restart to apply";
  if (before === after) return `caret ${after} in Claude Code — already current`;
  return `caret ${before} → ${after} in Claude Code — restart to apply`;
}

/** One `claude` invocation in a phase. `fallback` is a second command tried only when
 * the first fails (local mode's marketplace add → update pair); `fatal` then describes
 * the pair. */
interface PhaseCommand {
  args: string[];
  fatal: boolean;
  fallback?: string[];
  /** Display-only: the condition the dry-run preview prints before this command. */
  when?: string;
}

/** What a phase's commands returned, one entry per entry in `commands` and in the same
 * order — pushed even for a failed non-fatal command, so the positions stay aligned. */
type CommandResults = Awaited<ReturnType<ClaudeRunner>>[];

/** One reported phase: the label its spinner carries, an optional local-side effect to
 * perform first, and the `claude` commands it covers. `marketplace add` and `enable` are
 * best-effort — an already-registered marketplace or already-enabled plugin is not a
 * failure — so a phase fails only when one of its `fatal` commands does. */
interface Phase {
  label: string;
  /** The settled line. A function when the line reports what the commands returned rather
   * than what was attempted. */
  done: string | ((results: CommandResults) => string);
  /** A warning to emit after the step settles, or null for nothing to say. The seam for a
   * best-effort command whose failure the settled line alone cannot convey. */
  warn?: (results: CommandResults) => string | null;
  /** Runs before the phase's commands; local mode generates its marketplace here. */
  before?: () => void;
  commands: PhaseCommand[];
}

function phases({
  uninstall,
  local,
  writeDev,
  handBack,
}: {
  uninstall: boolean;
  local: LocalInstall | undefined;
  writeDev: (repoDir: string, outDir: string) => void;
  /** Whether Claude's `caret` marketplace is caret's own dev one, to remove first. */
  handBack: boolean;
}): Phase[] {
  if (uninstall) {
    return [
      {
        label: "Removing the caret plugin",
        // The command is best-effort because `--uninstall` sweeps every agent and
        // `plugin uninstall` exits non-zero on a plugin Claude never had. That makes the
        // settled line the only place the two outcomes are distinguishable, so it reports
        // what came back rather than what was attempted.
        done: ([removed]) =>
          removed?.ok
            ? `Removed caret from Claude Code (${PLUGIN_REF})`
            : "caret was not installed in Claude Code",
        commands: [{ args: ["plugin", "uninstall", PLUGIN_REF], fatal: false }],
      },
    ];
  }
  if (local) {
    return [
      {
        label: "Registering the local caret marketplace",
        done: `Registered the local dev marketplace (${local.marketplaceDir})`,
        before: () => writeDev(local.repoDir, local.marketplaceDir),
        // Fatal, unlike the published path's best-effort add: registration is what makes
        // the local build (rather than the published plugin) the thing installed below, so
        // a run where neither the add nor its update landed must stop rather than install
        // something else. `update` re-reads whichever source is registered under the name
        // `caret` — on a machine whose `caret` marketplace is still the public one, that
        // succeeds and the published plugin installs. Removing and re-adding would close
        // that gap at the cost of tearing down a user's marketplace registration.
        commands: [
          {
            args: ["plugin", "marketplace", "add", local.marketplaceDir],
            fatal: true,
            fallback: ["plugin", "marketplace", "update", MARKETPLACE_NAME],
          },
        ],
      },
      {
        label: "Installing the caret plugin",
        done: `Installed the local caret build in Claude Code (${PLUGIN_REF})`,
        // Uninstall first so the fresh build lands in the plugin cache: a dev build's
        // version is unchanged between rebuilds, so `install` alone may not re-copy the
        // symlinked tree.
        commands: [
          { args: ["plugin", "uninstall", PLUGIN_REF], fatal: false },
          { args: ["plugin", "install", PLUGIN_REF, "--scope", "user"], fatal: true },
          { args: ["plugin", "enable", PLUGIN_REF], fatal: false },
        ],
      },
    ];
  }
  return [
    ...(handBack
      ? [
          {
            label: "Handing the caret marketplace back from the local build",
            done: ([removed]: CommandResults) =>
              removed?.ok
                ? "Handed the caret marketplace back from the local build"
                : "Could not hand the caret marketplace back from the local build",
            warn: ([removed]: CommandResults) =>
              removed?.ok === false
                ? `\`claude plugin marketplace remove caret\`: ${removed.detail}`
                : null,
            commands: [
              {
                args: ["plugin", "marketplace", "remove", MARKETPLACE_NAME],
                fatal: false,
                when: "caret's local dev marketplace is registered",
              },
            ],
          },
        ]
      : []),
    {
      label: "Registering the caret marketplace",
      done: ([, , listed]) => {
        const after = readCaretMarketplace(listed?.stdout ?? "");
        if (isPublished(after)) return `Registered the caret marketplace (${MARKETPLACE_SOURCE})`;
        return after.kind === "registered"
          ? `Claude Code's caret marketplace is ${after.location}, not ${MARKETPLACE_SOURCE}`
          : "Could not register the caret marketplace";
      },
      warn: ([add, , listed]) =>
        registrationWarning(add, readCaretMarketplace(listed?.stdout ?? ""), handBack),
      // Both best-effort, and the update is unconditional rather than a fallback: the add
      // no-ops on a machine where the marketplace is already registered, so without a
      // refresh every command below would run against the metadata Claude already had.
      commands: [
        { args: ["plugin", "marketplace", "add", MARKETPLACE_SOURCE], fatal: false },
        { args: ["plugin", "marketplace", "update", MARKETPLACE_NAME], fatal: false },
        { args: ["plugin", "marketplace", "list", "--json"], fatal: false },
      ],
    },
    {
      label: "Installing the caret plugin",
      done: `Installed caret in Claude Code (${PLUGIN_REF})`,
      commands: [
        { args: ["plugin", "install", PLUGIN_REF, "--scope", "user"], fatal: true },
        { args: ["plugin", "enable", PLUGIN_REF], fatal: false },
      ],
    },
    {
      // `install` leaves an already-installed plugin at the version Claude has, so
      // upgrading caret would otherwise leave caret-in-Claude-Code behind. Reading the
      // version on either side of the update is what lets the settled line report what
      // actually moved instead of what was asked for. All best-effort: a failed update
      // must not fail an install that otherwise landed.
      label: "Updating the caret plugin",
      done: ([before, update, after]) =>
        updateLine(
          parsePluginVersion(before?.stdout ?? "", PLUGIN_REF),
          parsePluginVersion(after?.stdout ?? "", PLUGIN_REF),
          update?.ok === true,
        ),
      warn: ([, update]) =>
        update?.ok === false
          ? `Claude Code did not take the update (${update.detail}) — caret there is unchanged.`
          : null,
      commands: [
        { args: ["plugin", "list", "--json"], fatal: false },
        { args: ["plugin", "update", PLUGIN_REF, "--scope", "user"], fatal: false },
        { args: ["plugin", "list", "--json"], fatal: false },
      ],
    },
  ];
}

/** Raised by a phase whose fatal command failed, so the reporter settles that step as
 * failed; the caller catches it and reports the reason. */
class PhaseFailure extends Error {
  constructor(
    readonly reason: string,
    readonly missing: boolean,
  ) {
    super(reason);
  }
}

/** Whether Claude's `caret` marketplace is caret's own dev marketplace directory. */
async function registeredAtDevDir(
  run: ClaudeRunner,
  devDir: () => string = devMarketplaceDir,
): Promise<boolean> {
  const m = readCaretMarketplace((await run(["plugin", "marketplace", "list", "--json"])).stdout);
  return (
    m.kind === "registered" && m.source === "directory" && resolve(m.location) === resolve(devDir())
  );
}

/** Install (or, with `uninstall`, remove) caret in Claude Code via its plugin CLI,
 * reporting one step per phase. `local` installs the checkout it describes instead of the
 * published plugin. A missing `claude` reports guidance and stops without throwing.
 *
 * Returns false when a phase failed (already reported), so the caller can fail the run
 * rather than closing with a success line over an install that did not happen. */
export async function runInstallClaudeTarget(
  opts: { uninstall: boolean; dryRun: boolean; local?: LocalInstall },
  deps: {
    claude?: ClaudeRunner;
    ui?: InstallUI;
    writeDevMarketplace?: (repoDir: string, outDir: string) => void;
    devMarketplaceDir?: () => string;
  } = {},
): Promise<boolean> {
  const run = deps.claude ?? claudeCli;
  const ui = deps.ui ?? silentUI;
  const local = opts.uninstall ? undefined : opts.local;
  const published = !opts.uninstall && !local;
  // Dry-run cannot probe without spawning, so its preview shows the hand-back as conditional.
  const handBack =
    published && (opts.dryRun || (await registeredAtDevDir(run, deps.devMarketplaceDir)));
  const plan = phases({
    uninstall: opts.uninstall,
    local,
    writeDev: deps.writeDevMarketplace ?? writeDevMarketplace,
    handBack,
  });

  if (opts.dryRun) {
    const lines = plan.flatMap((p) => [
      ...(local && p.before ? [`write the dev marketplace at ${local.marketplaceDir}`] : []),
      ...p.commands.flatMap((c) => [
        `${c.when ? `(if ${c.when}) ` : ""}claude ${c.args.join(" ")}`,
        ...(c.fallback ? [`  (on failure) claude ${c.fallback.join(" ")}`] : []),
      ]),
    ]);
    ui.note(lines.join("\n"), `Claude Code${local ? " (local build)" : ""} — would run`);
    return true;
  }

  for (const phase of plan) {
    try {
      const results = await ui.step(
        phase.label,
        async (detail) => {
          phase.before?.();
          const collected: CommandResults = [];
          for (const { args, fatal, fallback } of phase.commands) {
            detail(`claude ${args.join(" ")}`);
            let r = await run(args);
            if (!r.ok && !r.missing && fallback) {
              detail(`claude ${fallback.join(" ")}`);
              r = await run(fallback);
            }
            collected.push(r);
            if (r.ok) continue;
            // A missing CLI ends the whole target, not just this command — every
            // remaining phase would fail the same way.
            if (r.missing) throw new PhaseFailure(r.detail, true);
            if (fatal) throw new PhaseFailure(`\`claude ${args.join(" ")}\`: ${r.detail}`, false);
          }
          return collected;
        },
        (collected) => (typeof phase.done === "string" ? phase.done : phase.done(collected)),
      );
      // After the step settles, so the warning sits below the line it qualifies.
      const warning = phase.warn?.(results);
      if (warning) ui.warn(warning);
    } catch (e) {
      if (!(e instanceof PhaseFailure)) throw e;
      // A machine with no `claude` cannot have caret in Claude Code, so there is nothing
      // to remove and nothing to report — and `--uninstall` sweeps every agent, so this is
      // the ordinary case on a machine that only runs one of them.
      if (e.missing && opts.uninstall) {
        ui.info("No `claude` CLI on this machine — nothing to remove from Claude Code.");
        return true;
      }
      ui.error(
        e.missing
          ? `The \`claude\` CLI was not found. Install Claude Code (https://claude.com/claude-code) and re-run \`caret install\`, or add caret in Claude Code via \`/plugin marketplace add ${MARKETPLACE_SOURCE}\`.`
          : `Claude Code: ${e.reason}`,
      );
      return false;
    }
  }
  return true;
}
