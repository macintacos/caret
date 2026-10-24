// The one decision every command makes before it writes ANSI colour.

/** Whether output to one stream should wear ANSI colour: only a terminal, and only when
 * neither the environment (`NO_COLOR` set and non-empty, `TERM=dumb`, `CI=true`) nor the
 * `--no-color` flag asked for plain text. A command that colours both stdout and stderr
 * asks once per stream, since either can be piped while the other stays a terminal. */
export function wantsColor(opts: {
  isTTY: boolean | undefined;
  env: Record<string, string | undefined>;
  noColorFlag: boolean;
}): boolean {
  const { isTTY, env, noColorFlag } = opts;
  return (
    isTTY === true && !noColorFlag && !env.NO_COLOR && env.TERM !== "dumb" && env.CI !== "true"
  );
}
