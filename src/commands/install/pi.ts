// caret's pi install target. Every change goes through pi's own package commands
// (`pi install`, `pi update`, `pi remove`), so pi's settings.json stays pi's to write.

import { homedir } from "node:os";
import { resolve } from "node:path";

import { PI_FLOOR, type PiVersion, readPiVersion } from "@/adapters/pi/host.ts";
import { type PiCaretEntry, piAgentDir, readPiCaretEntries } from "@/adapters/pi/install.ts";
import type { LocalInstall } from "@/commands/install/local.ts";
import { type InstallUI, silentUI } from "@/commands/install/ui.ts";
import { errorMessage } from "@/lib/types.ts";
import { runCommand } from "@/service/run.ts";

const CARET_NPM_SOURCE = "npm:@macintacos/caret";
const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/** Run a `pi` subcommand: ok, or a failure detail. Never rejects. */
export type PiRunner = (args: string[]) => Promise<{ ok: boolean; detail: string }>;

// A missing binary comes back from runCommand as code 127; the preflight already decided.
const piCli: PiRunner = async (args) => {
  const { code, stderr } = await runCommand(["pi", ...args]);
  return { ok: code === 0, detail: stderr.trim() || `pi exited ${code}` };
};

type PiCommand =
  | { kind: "remove"; entry: PiCaretEntry }
  | { kind: "install"; source: string }
  | { kind: "update"; entry: PiCaretEntry };

/** The commands to run, in order, plus a pinned npm entry left alone. */
interface PiPlan {
  commands: PiCommand[];
  pinned?: PiCaretEntry;
}

type NpmEntry = Extract<PiCaretEntry, { form: "npm" }>;

/**
 * pi matches npm entries by name and local ones by path, so both can coexist and caret
 * would load twice; every mode but uninstall keeps exactly one. `--from-local` keeps only
 * this checkout's own entry. The install or update runs first, so a failure there never
 * leaves pi without a working caret.
 */
function planPi(
  entries: PiCaretEntry[],
  { uninstall, localDir }: { uninstall: boolean; localDir?: string },
): PiPlan {
  const removeAll = (es: PiCaretEntry[]) =>
    es.map((entry): PiCommand => ({ kind: "remove", entry }));
  if (uninstall) return { commands: removeAll(entries) };
  if (localDir !== undefined) {
    const others = entries.filter((e) => !(e.form === "local" && e.dir === localDir));
    return { commands: [{ kind: "install", source: localDir }, ...removeAll(others)] };
  }
  const removals = removeAll(entries.filter((e) => e.form === "local"));
  const npm = entries.find((e): e is NpmEntry => e.form === "npm");
  if (!npm) return { commands: [{ kind: "install", source: CARET_NPM_SOURCE }, ...removals] };
  // `pi install` over a pinned entry rewrites the pin away.
  if (npm.pinned) return { commands: removals, pinned: npm };
  return { commands: [{ kind: "update", entry: npm }, ...removals] };
}

function piArgs(command: PiCommand): string[] {
  switch (command.kind) {
    case "remove":
      return ["remove", removeArg(command.entry)];
    case "install":
      return ["install", command.source];
    case "update":
      // A bare `pi update` updates pi itself.
      return ["update", CARET_NPM_SOURCE];
  }
}

// `pi remove` resolves a path against the cwd, so a local entry goes by its resolved dir.
const removeArg = (entry: PiCaretEntry) => (entry.form === "npm" ? entry.source : entry.dir);

/** The settled line for `pi update`; either version is null when pi lists caret but its
 * package.json can't be read. */
function piUpdateLine(before: string | null, after: string | null, updated: boolean): string {
  if (!updated) {
    return before
      ? `caret ${before} in pi — the update did not land`
      : "Could not ask pi for the latest caret";
  }
  if (!before || !after) return "Asked pi for the latest caret";
  if (before === after) return `caret ${after} in pi — already current`;
  return `caret ${before} → ${after} in pi`;
}

/** Guidance for a pi that can't take caret; null when it can. */
function preflightError(version: PiVersion): string | null {
  switch (version.status) {
    case "ok":
      return null;
    case "missing":
      return `Couldn't run \`pi --version\`. Install \`${PI_PACKAGE}\` (${PI_FLOOR} or later) and re-run \`caret install\`.`;
    case "pre-rename":
      return `pi ${version.version} is the old \`@mariozechner/pi-coding-agent\`. pi is now published as \`${PI_PACKAGE}\` — install that (${PI_FLOOR} or later) and re-run \`caret install\`.`;
    case "too-old":
      return `pi ${version.version} is older than ${PI_FLOOR}. Upgrade \`${PI_PACKAGE}\` and re-run \`caret install\`.`;
    default:
      return version satisfies never;
  }
}

function previewPlan(plan: PiPlan, ui: InstallUI): void {
  const lines = plan.commands.map((c) => `pi ${piArgs(c).join(" ")}`);
  if (plan.pinned) lines.unshift(`(pinned, left alone) ${plan.pinned.source}`);
  ui.note(lines.join("\n"), "pi — would run");
}

interface RunContext {
  run: PiRunner;
  ui: InstallUI;
  uninstall: boolean;
  readNpmVersion: () => string | null;
}

/** Run one command behind a step. Returns whether it succeeded; throws only for a
 * failure that must stop the run. */
async function runPiCommand(command: PiCommand, ctx: RunContext): Promise<boolean> {
  const args = piArgs(command);
  const exec = async () => {
    const r = await ctx.run(args);
    if (!r.ok) throw new Error(`\`pi ${args.join(" ")}\`: ${r.detail}`);
  };
  switch (command.kind) {
    case "remove": {
      const arg = args[1];
      try {
        await ctx.ui.step(`Removing ${arg} from pi`, exec, () => `Removed ${arg} from pi`);
        return true;
      } catch (e) {
        // The uninstall sweep must not block the service teardown that follows it.
        if (!ctx.uninstall) throw e;
        ctx.ui.warn(`pi: ${errorMessage(e)}`);
        return false;
      }
    }
    case "install":
      await ctx.ui.step(`Installing ${command.source} in pi`, exec, () =>
        command.source === CARET_NPM_SOURCE
          ? `Installed ${command.source} in pi`
          : `Installed ${command.source} in pi — pi loads the checkout in place, so a rebuild applies after \`/reload\``,
      );
      return true;
    case "update": {
      const before = command.entry.version;
      let failure: string | null = null;
      await ctx.ui.step(
        `Updating ${CARET_NPM_SOURCE} in pi`,
        async () => {
          try {
            await exec();
          } catch (e) {
            failure = errorMessage(e);
          }
          return ctx.readNpmVersion();
        },
        (after) => piUpdateLine(before, after, failure === null),
      );
      // caret is already installed, so a failed update must not fail the install.
      if (failure !== null)
        ctx.ui.warn(`pi did not take the update (${failure}) — caret there is unchanged.`);
      return failure === null;
    }
  }
}

/** Run the plan; false after a fatal failure, already reported. */
async function runPlan(plan: PiPlan, ctx: RunContext): Promise<boolean> {
  const removed: string[] = [];
  try {
    for (const command of plan.commands) {
      const ok = await runPiCommand(command, ctx);
      if (ok && command.kind === "remove") removed.push(removeArg(command.entry));
    }
  } catch (e) {
    ctx.ui.error(`pi: ${errorMessage(e)}`);
    return false;
  }
  if (plan.pinned) {
    ctx.ui.info(
      `${plan.pinned.source} is pinned, so caret left it alone — \`pi install ${CARET_NPM_SOURCE}\` unpins it.`,
    );
  }
  if (!ctx.uninstall && removed.length > 0) {
    ctx.ui.info(`Removed ${removed.join(", ")} from pi so it loads caret once.`);
  }
  return true;
}

/**
 * Install, update, or remove caret in pi through pi's own package commands. Install needs
 * a pi that reports an `ok` version; uninstall skips only a pi that can't run at all, and
 * treats each removal as best-effort, so the sweep never blocks the service teardown that
 * follows it. Returns false after a failure already reported through `ui`; never throws.
 */
export async function runInstallPiTarget(
  opts: { uninstall: boolean; dryRun: boolean; local?: LocalInstall },
  deps: {
    pi?: PiRunner;
    piVersion?: () => PiVersion;
    agentDir?: string;
    home?: string;
    ui?: InstallUI;
  } = {},
): Promise<boolean> {
  const ui = deps.ui ?? silentUI;
  const version = (deps.piVersion ?? readPiVersion)();
  if (opts.uninstall && version.status === "missing") {
    ui.info("Couldn't run `pi --version` — nothing removed from pi.");
    return true;
  }
  const blocked = opts.uninstall ? null : preflightError(version);
  if (blocked !== null) {
    ui.error(blocked);
    return false;
  }

  const agentDir = deps.agentDir ?? piAgentDir();
  const home = deps.home ?? homedir();
  const localDir = opts.local ? resolve(opts.local.repoDir) : undefined;
  const plan = planPi(readPiCaretEntries(agentDir, home), { uninstall: opts.uninstall, localDir });
  if (opts.uninstall && plan.commands.length === 0) {
    ui.info("pi has no caret entry — nothing to remove.");
    return true;
  }
  if (opts.dryRun) {
    previewPlan(plan, ui);
    return true;
  }
  return runPlan(plan, {
    run: deps.pi ?? piCli,
    ui,
    uninstall: opts.uninstall,
    readNpmVersion: () =>
      readPiCaretEntries(agentDir, home).find((e) => e.form === "npm")?.version ?? null,
  });
}
