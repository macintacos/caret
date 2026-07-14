// caret's Claude Code install target. `caret install --target claude` registers
// caret's PUBLISHED plugin with Claude Code by driving its CLI: add caret's
// marketplace, then install and enable the plugin. `--uninstall` removes it. The
// command shapes mirror scripts/install.sh (which additionally handles the dev/local
// `--from-local` marketplace). Shelling out to `claude` is injected so the flow is
// unit-testable, and a missing `claude` degrades to printed guidance, never a throw.

/** caret's public marketplace source and the `plugin@marketplace` id Claude uses
 * (both the marketplace and the plugin are named `caret`). */
const MARKETPLACE_SOURCE = "macintacos/caret";
const PLUGIN_REF = "caret@caret";

/** Run a `claude` subcommand. Returns ok + a failure detail rather than throwing;
 * `missing: true` means the `claude` CLI wasn't found on PATH. */
export type ClaudeRunner = (args: string[]) => { ok: boolean; detail: string; missing?: boolean };

/** Production runner: `claude <args>`, output captured. A missing binary is reported
 * as `missing` (so the caller prints install guidance); any other non-zero exit is a
 * reported failure. Never throws. */
const claudeCli: ClaudeRunner = (args) => {
  try {
    const res = Bun.spawnSync(["claude", ...args], { stdout: "pipe", stderr: "pipe" });
    if (res.exitCode === 0) return { ok: true, detail: "" };
    const err = new TextDecoder().decode(res.stderr).trim();
    return { ok: false, detail: err || `claude exited ${res.exitCode}` };
  } catch (e) {
    const missing = e instanceof Error && (e as NodeJS.ErrnoException).code === "ENOENT";
    return { ok: false, missing, detail: e instanceof Error ? e.message : String(e) };
  }
};

/** Install (or, with `uninstall`, remove) caret in Claude Code via its plugin CLI.
 * `marketplace add` and `enable` are best-effort (an already-registered marketplace
 * or already-enabled plugin is not a failure); `plugin install` is the step that
 * must succeed. A missing `claude` prints guidance and stops without erroring. */
export function runInstallClaudeTarget(
  opts: { uninstall: boolean; dryRun: boolean },
  deps: { claude?: ClaudeRunner } = {},
): void {
  const run = deps.claude ?? claudeCli;
  const steps: string[][] = opts.uninstall
    ? [["plugin", "uninstall", PLUGIN_REF]]
    : [
        ["plugin", "marketplace", "add", MARKETPLACE_SOURCE],
        ["plugin", "install", PLUGIN_REF, "--scope", "user"],
        ["plugin", "enable", PLUGIN_REF],
      ];

  if (opts.dryRun) {
    process.stdout.write("caret: [dry-run] would run for Claude Code:\n");
    for (const s of steps) process.stdout.write(`  claude ${s.join(" ")}\n`);
    return;
  }

  for (const args of steps) {
    const r = run(args);
    if (r.ok) continue;
    if (r.missing) {
      process.stderr.write(
        `caret: the \`claude\` CLI was not found. Install Claude Code (https://claude.com/claude-code) and re-run \`caret install --target claude\`, or add caret in Claude Code via \`/plugin marketplace add ${MARKETPLACE_SOURCE}\`.\n`,
      );
      return;
    }
    if (args[1] !== "install") continue; // marketplace add / enable / uninstall are best-effort
    process.stderr.write(`caret: \`claude ${args.join(" ")}\` failed: ${r.detail}\n`);
    return;
  }
  const verb = opts.uninstall ? "removed" : "installed";
  process.stdout.write(`caret: ${verb} caret in Claude Code (${PLUGIN_REF}).\n`);
}
