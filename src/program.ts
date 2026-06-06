// Shared Commander scaffolding for caret's two CLIs (src/cli.ts and the release
// pipeline at scripts/release/cli.ts). Both build a Commander tree with the same
// name/description/help conventions and run it behind the same entrypoint guard;
// only their error handling diverges, so that is the one parameter callers pass.

import { Command } from "@commander-js/extra-typings";

/**
 * A Commander program with caret's shared conventions: a name, a description, and
 * showHelpAfterError so a parse error prints usage.
 *
 * We never call exitOverride(): a parse error (unknown command/option, or a bare
 * invocation) prints usage to stderr and exits non-zero via Commander's default,
 * synchronously during parse. It can never reach runProgram's catch below, so a
 * parse error never reaches an onError handler — the caret CLI's fail-safe deny
 * and the release CLI's JSON-on-stdout discipline both rely on this.
 */
export function createProgram(name: string, description: string): Command {
  return new Command().name(name).description(description).showHelpAfterError();
}

/**
 * Parse argv and run the program, routing any thrown error (including an async
 * action's rejection) to `onError`. parseAsync (not parse) so a rejected action
 * propagates to the catch instead of surfacing as an unhandled rejection. Each
 * CLI supplies its own onError: the caret CLI denies to fail safe; the release
 * CLI emits a typed JSON error on stdout.
 */
export function runProgram(program: Command, onError: (err: unknown) => void): void {
  program.parseAsync(process.argv).catch(onError);
}
