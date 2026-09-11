// `@core`, not `@/`: the UI suites import this too, and there `@/` is ui/src.
import type { DaemonDiagnostics } from "@core/lib/types.ts";

/** A fixed GET /api/diagnostics document. The Advanced pane's unit and e2e suites assert
 * the text it renders to, so a changed value changes their expectations too. */
export function fakeDiagnostics(): DaemonDiagnostics {
  return {
    system: { platform: "darwin", arch: "arm64", runtime: "bun 0.0.0" },
    uptimeMs: 2 * 3_600_000 + 14 * 60_000,
    resident: false,
    upkeep: [],
    settings: { daemon: { port: 42718 }, review: { timeout_s: 3600 } },
    config: { path: "/Users/x/.config/caret/config.toml", exists: true, env: [] },
  };
}
