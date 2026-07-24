// caret's Claude Code install target. `caret install --target claude` registers
// caret's PUBLISHED plugin with Claude Code by driving its CLI: add caret's
// marketplace, then install and enable the plugin. `--uninstall` removes it. The
// command shapes mirror scripts/install.sh (which additionally handles the dev/local
// `--from-local` marketplace). Shelling out to `claude` is injected so the flow is
// unit-testable, and a missing `claude` degrades to reported guidance, never a throw.
//
// The `claude` calls are async (not spawnSync) so the reporter's spinner keeps
// animating while each one runs — a blocked event loop would freeze it mid-frame and
// read as a hang.

import type { InstallUI } from "@/commands/install/ui.ts";
import { silentUI } from "@/commands/install/ui.ts";

/** caret's public marketplace source and the `plugin@marketplace` id Claude uses
 * (both the marketplace and the plugin are named `caret`). */
const MARKETPLACE_SOURCE = "macintacos/caret";
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

/** One reported phase: the label its spinner carries, and the `claude` commands it
 * covers. `marketplace add` and `enable` are best-effort — an already-registered
 * marketplace or already-enabled plugin is not a failure — so a phase fails only when
 * one of its `fatal` commands does. */
interface Phase {
  label: string;
  done: string;
  commands: { args: string[]; fatal: boolean }[];
}

function phases(uninstall: boolean): Phase[] {
  if (uninstall) {
    return [
      {
        label: "Removing the caret plugin",
        done: `Removed caret from Claude Code (${PLUGIN_REF})`,
        commands: [{ args: ["plugin", "uninstall", PLUGIN_REF], fatal: false }],
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
 * reporting one step per phase. A missing `claude` reports guidance and stops without
 * throwing. */
export async function runInstallClaudeTarget(
  opts: { uninstall: boolean; dryRun: boolean },
  deps: { claude?: ClaudeRunner; ui?: InstallUI } = {},
): Promise<void> {
  const run = deps.claude ?? claudeCli;
  const ui = deps.ui ?? silentUI;
  const plan = phases(opts.uninstall);

  if (opts.dryRun) {
    const lines = plan.flatMap((p) => p.commands.map((c) => `claude ${c.args.join(" ")}`));
    ui.note(lines.join("\n"), "Claude Code — would run");
    return;
  }

  for (const phase of plan) {
    try {
      await ui.step(
        phase.label,
        async (detail) => {
          for (const { args, fatal } of phase.commands) {
            detail(`claude ${args.join(" ")}`);
            const r = await run(args);
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
      return;
    }
  }
}
