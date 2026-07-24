// caret's Claude Code install target. `caret install --target claude` registers
// caret's PUBLISHED plugin with Claude Code by driving its CLI: add caret's
// marketplace, then install and enable the plugin. `--uninstall` removes it. With
// `--from-local` the same CLI installs the LOCAL build instead: the marketplace source
// becomes the generated dev marketplace (see local.ts) rather than the public one.
// Shelling out to `claude` is injected so the flow is unit-testable, and a missing
// `claude` degrades to reported guidance, never a throw.
//
// The `claude` calls are async (not spawnSync) so the reporter's spinner keeps
// animating while each one runs — a blocked event loop would freeze it mid-frame and
// read as a hang.

import type { LocalInstall } from "@/commands/install/local.ts";
import { writeDevMarketplace } from "@/commands/install/local.ts";
import type { InstallUI } from "@/commands/install/ui.ts";
import { silentUI } from "@/commands/install/ui.ts";

/** caret's public marketplace source, the marketplace's registered name, and the
 * `plugin@marketplace` id Claude uses (both the marketplace and the plugin are named
 * `caret`). */
const MARKETPLACE_SOURCE = "macintacos/caret";
const MARKETPLACE_NAME = "caret";
const PLUGIN_REF = "caret@caret";

/** Run a `claude` subcommand. Resolves ok + a failure detail rather than rejecting;
 * `missing: true` means the `claude` CLI wasn't found on PATH. */
export type ClaudeRunner = (
  args: string[],
) => Promise<{ ok: boolean; detail: string; missing?: boolean }>;

/** Production runner: `claude <args>`, output captured. A missing binary is reported
 * as `missing` (so the caller reports install guidance); any other non-zero exit is a
 * reported failure. Never rejects. */
const claudeCli: ClaudeRunner = async (args) => {
  try {
    const proc = Bun.spawn(["claude", ...args], { stdout: "pipe", stderr: "pipe" });
    const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    if (code === 0) return { ok: true, detail: "" };
    return { ok: false, detail: err.trim() || `claude exited ${code}` };
  } catch (e) {
    const missing = e instanceof Error && (e as NodeJS.ErrnoException).code === "ENOENT";
    return { ok: false, missing, detail: e instanceof Error ? e.message : String(e) };
  }
};

/** One `claude` invocation in a phase. `fallback` is a second command tried only when
 * the first fails (the marketplace add → update pair); `fatal` then describes the pair. */
interface PhaseCommand {
  args: string[];
  fatal: boolean;
  fallback?: string[];
}

/** One reported phase: the label its spinner carries, an optional local-side effect to
 * perform first, and the `claude` commands it covers. `marketplace add` and `enable` are
 * best-effort — an already-registered marketplace or already-enabled plugin is not a
 * failure — so a phase fails only when one of its `fatal` commands does. */
interface Phase {
  label: string;
  done: string;
  /** Runs before the phase's commands; local mode generates its marketplace here. */
  before?: () => void;
  commands: PhaseCommand[];
}

function phases(
  uninstall: boolean,
  local: LocalInstall | undefined,
  writeDev: (repoDir: string, outDir: string) => void,
): Phase[] {
  if (uninstall) {
    return [
      {
        label: "Removing the caret plugin",
        done: `Removed caret from Claude Code (${PLUGIN_REF})`,
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
    {
      label: "Registering the caret marketplace",
      done: `Registered the caret marketplace (${MARKETPLACE_SOURCE})`,
      commands: [{ args: ["plugin", "marketplace", "add", MARKETPLACE_SOURCE], fatal: false }],
    },
    {
      label: "Installing the caret plugin",
      done: `Installed caret in Claude Code (${PLUGIN_REF})`,
      commands: [
        { args: ["plugin", "install", PLUGIN_REF, "--scope", "user"], fatal: true },
        { args: ["plugin", "enable", PLUGIN_REF], fatal: false },
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
  } = {},
): Promise<boolean> {
  const run = deps.claude ?? claudeCli;
  const ui = deps.ui ?? silentUI;
  const local = opts.uninstall ? undefined : opts.local;
  const plan = phases(opts.uninstall, local, deps.writeDevMarketplace ?? writeDevMarketplace);

  if (opts.dryRun) {
    const lines = plan.flatMap((p) => [
      ...(local && p.before ? [`write the dev marketplace at ${local.marketplaceDir}`] : []),
      ...p.commands.flatMap((c) => [
        `claude ${c.args.join(" ")}`,
        ...(c.fallback ? [`  (on failure) claude ${c.fallback.join(" ")}`] : []),
      ]),
    ]);
    ui.note(lines.join("\n"), `Claude Code${local ? " (local build)" : ""} — would run`);
    return true;
  }

  for (const phase of plan) {
    try {
      await ui.step(
        phase.label,
        async (detail) => {
          phase.before?.();
          for (const { args, fatal, fallback } of phase.commands) {
            detail(`claude ${args.join(" ")}`);
            let r = await run(args);
            if (!r.ok && !r.missing && fallback) {
              detail(`claude ${fallback.join(" ")}`);
              r = await run(fallback);
            }
            if (r.ok) continue;
            // A missing CLI ends the whole target, not just this command — every
            // remaining phase would fail the same way.
            if (r.missing) throw new PhaseFailure(r.detail, true);
            if (fatal) throw new PhaseFailure(`\`claude ${args.join(" ")}\`: ${r.detail}`, false);
          }
        },
        () => phase.done,
      );
    } catch (e) {
      if (!(e instanceof PhaseFailure)) throw e;
      ui.error(
        e.missing
          ? `The \`claude\` CLI was not found. Install Claude Code (https://claude.com/claude-code) and re-run \`caret install --target claude\`, or add caret in Claude Code via \`/plugin marketplace add ${MARKETPLACE_SOURCE}\`.`
          : `Claude Code: ${e.reason}`,
      );
      return false;
    }
  }
  return true;
}
