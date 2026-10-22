// Claude Code's plan-waiting band. caret's CLI owns the link — host, port, login token —
// and the band's on/off setting, so nothing here repeats caret's rules.
import type { Hook, Register } from "claude-code";
import { atom, read, update } from "claude-code";

type Shown = { session: string; url: string };
type HookDollar = Parameters<Hook<"tool.call">>[0];

const band = atom({ plugin: "caret", key: "band" } as const, null as Shown | null);

// $.process.run takes no shell, and Windows cannot exec bin/caret's shebang.
const caret = ($: HookDollar, ...args: string[]) =>
  $.process.run(["bash", `${$.plugin.root}/bin/caret`, ...args], { timeoutMs: 15_000 });

// A band that breaks must never hold up the review: pass the event on.
const passThrough = <E, R>(_: unknown, e: E, next: (e: E) => R) => next(e);

const bandWhile = async <T,>(
  $: HookDollar,
  session: string,
  signal: AbortSignal,
  review: () => Promise<T>,
): Promise<T> => {
  let settled = false;
  const clear = async () => {
    settled = true;
    await update($, band, () => null);
  };
  // An interrupt aborts the signal; nothing promises it settles `review`.
  signal.addEventListener("abort", () => void clear(), { once: true });
  // Not awaited: the review never waits on the band.
  void caret($, "band-link", "--session", session).then(
    async ({ stdout }) => {
      const url = stdout.trim();
      if (url && !settled) await update($, band, () => ({ session, url }));
    },
    () => {},
  );
  try {
    return await review();
  } finally {
    await clear();
  }
};

export const register: Register = (on) => {
  on("tool.call", { tool: "mcp__plugin_caret_caret__review_plan" }, async ($, e, next) =>
    bandWhile($, await $.session.id(), next.signal, () => next(e)),
  ).catch(passThrough);
  // caret's own PermissionRequest hook sits beneath this one and holds the plan until a decision.
  on("classic.PermissionRequest", { tool_name: "ExitPlanMode" }, ($, e, next) =>
    bandWhile($, e.session_id, next.signal, () => next(e)),
  ).catch(passThrough);
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const shown = await read($, band);
    if (e.props.hasSurvey || shown === null) return next(e);
    const { Box, Button, Link, Text } = $.ui.resolve(e);
    return (
      <Box gap={1}>
        <Link href={shown.url}>
          <Text bold color="inverseText" backgroundColor="warning">
            {" 🥕 CARET PLAN WAITING FOR YOUR REVIEW "}
          </Text>
        </Link>
        {/* A bare digit in an empty prompt presses a band Button. */}
        <Button
          hotkey="1"
          plain
          onPress={() => caret($, "band-link", "--session", shown.session, "--open")}
        >
          open in browser
        </Button>
      </Box>
    );
  });
};
