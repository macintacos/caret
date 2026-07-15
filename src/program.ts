// Shared Commander scaffolding for caret's CLIs: the product CLI (src/cli.ts) and
// the dev/build/release tasks CLI (scripts/tasks/cli.ts, whose release subcommand
// group in scripts/tasks/release/command.ts reuses createProgram too). All build a
// Commander tree with the same name/description/help conventions. Error handling
// diverges per CLI: src/cli.ts runs behind runProgram's fail-safe deny (below),
// while the release group scopes its own JSON-on-stdout handling per action.

import { Command } from "@commander-js/extra-typings";

/**
 * A Commander program with caret's shared conventions: a name, a description, and
 * showHelpAfterError so a parse error prints usage.
 *
 * We never call exitOverride(): a parse error (unknown command/option, or a bare
 * invocation) prints usage to stderr and exits non-zero via Commander's default,
 * synchronously during parse. It can never reach runProgram's catch below, so a
 * parse error never reaches an onError handler — the product CLI's fail-safe deny
 * and the release group's JSON-on-stdout discipline both rely on this.
 */
export function createProgram(name: string, description: string): Command {
  return new Command().name(name).description(description).showHelpAfterError();
}

/**
 * Parse argv and run the program, routing any thrown error (including an async
 * action's rejection) to `onError`. parseAsync (not parse) so a rejected action
 * propagates to the catch instead of surfacing as an unhandled rejection. The
 * product CLI (src/cli.ts) supplies an onError that denies to fail safe; the
 * tasks CLI's release group scopes its JSON-on-stdout handling per action rather
 * than routing through here.
 */
export function runProgram(program: Command, onError: (err: unknown) => void): void {
  program.parseAsync(process.argv).catch(onError);
}
