// `/caret:doctor` for pi: runs `caret doctor` and shows its report in pi's transcript as
// a custom entry, which never reaches the model.

import { Text } from "@earendil-works/pi-tui";

import type { SpawnRunner } from "../opencode/review-bridge.ts";
import type { PiTheme } from "./render.ts";

/** The customType of the transcript entry, and the key of the footer status. */
export const DOCTOR_ENTRY = "caret-doctor";
export const DOCTOR_TIMEOUT_MS = 60_000;
/** Verdict lines without their glyph; doctorText adds it. */
export const PASSED_VERDICT = "caret doctor: every check passed";
export const FAILED_VERDICT = "caret doctor: at least one check failed";
export const NO_REPORT_VERDICT = "caret doctor produced no report";

/** What one `caret doctor` run came to; persisted as the `caret-doctor` entry's data. */
export type DoctorOutcome =
  | { kind: "report"; exitCode: 0 | 1; report: string }
  | { kind: "no-report"; exitCode: number | null; reason: string };

export type DoctorCommandContext = {
  mode: "tui" | "rpc" | "json" | "print";
  ui: { setStatus(key: string, text: string | undefined): void };
};

/** The slice of pi's extension API `/caret:doctor` calls; pinned by
 * test/pi/sdk-conformance.ts. It has no send method: the report stays out of model
 * context. */
export type DoctorApi = {
  registerCommand(
    name: string,
    options: {
      description: string;
      handler: (args: string, ctx: DoctorCommandContext) => Promise<void>;
    },
  ): void;
  appendEntry(customType: string, data: DoctorOutcome): void;
  registerEntryRenderer(customType: string, renderer: typeof renderDoctorEntry): void;
};

export type DoctorDeps = {
  bin: string;
  run: SpawnRunner;
  env: Record<string, string | undefined>;
};

/** Runs `caret doctor` and describes the outcome; never throws. */
export async function runDoctor({ bin, run, env }: DoctorDeps): Promise<DoctorOutcome> {
  let stderr = "";
  try {
    const { stdout, exitCode } = await run(
      [bin, "doctor", "--no-color"],
      { ...env, CARET_AGENT: "pi" },
      "",
      (chunk) => {
        stderr += chunk;
      },
      AbortSignal.timeout(DOCTOR_TIMEOUT_MS),
    );
    const report = stdout.trim();
    // A signal-killed child reports exit 0 with no output.
    if ((exitCode === 0 || exitCode === 1) && report) return { kind: "report", exitCode, report };
    return {
      kind: "no-report",
      exitCode,
      reason: stderr.trim() || `caret doctor exited ${exitCode} without a report.`,
    };
  } catch (err) {
    // The timeout is the only abort source.
    if (err instanceof Error && err.name === "AbortError")
      return {
        kind: "no-report",
        exitCode: null,
        reason: `caret doctor didn't finish within ${DOCTOR_TIMEOUT_MS / 1000} seconds.`,
      };
    const message = err instanceof Error ? err.message : String(err);
    return {
      kind: "no-report",
      exitCode: null,
      reason: `Couldn't start caret at ${bin}: ${message}`,
    };
  }
}

type Paint = (tone: "success" | "error", text: string) => string;

/** The verdict line, a blank line, then the report or the reason. */
export function doctorText(outcome: DoctorOutcome, paint: Paint = (_tone, s) => s): string {
  if (outcome.kind === "no-report")
    return `${paint("error", `✕ ${NO_REPORT_VERDICT}`)}\n\n${outcome.reason}`;
  const verdict =
    outcome.exitCode === 0
      ? paint("success", `✓ ${PASSED_VERDICT}`)
      : paint("error", `✕ ${FAILED_VERDICT}`);
  return `${verdict}\n\n${outcome.report}`;
}

function isDoctorOutcome(data: unknown): data is DoctorOutcome {
  if (typeof data !== "object" || data === null || !("kind" in data)) return false;
  if (data.kind === "report")
    return (
      "exitCode" in data &&
      (data.exitCode === 0 || data.exitCode === 1) &&
      "report" in data &&
      typeof data.report === "string"
    );
  if (data.kind === "no-report")
    return (
      "exitCode" in data &&
      (data.exitCode === null || typeof data.exitCode === "number") &&
      "reason" in data &&
      typeof data.reason === "string"
    );
  return false;
}

/** The entry's row. Draws from the entry's data alone, since pi re-renders persisted
 * entries on resume. */
export function renderDoctorEntry(
  entry: { data?: unknown },
  _options: unknown,
  theme: PiTheme,
): Text | undefined {
  if (!isDoctorOutcome(entry.data)) return undefined;
  return new Text(
    doctorText(entry.data, (tone, s) => theme.fg(tone, s)),
    0,
    0,
  );
}

/** Registers `/caret:doctor` and the renderer for its transcript entry. */
export function installDoctor(
  pi: DoctorApi,
  deps: DoctorDeps & { stdout: (text: string) => void },
): void {
  pi.registerEntryRenderer(DOCTOR_ENTRY, renderDoctorEntry);
  pi.registerCommand("caret:doctor", {
    description: "Check this caret install and show the report",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus(DOCTOR_ENTRY, "running caret doctor…");
      const outcome = await runDoctor(deps);
      ctx.ui.setStatus(DOCTOR_ENTRY, undefined);
      pi.appendEntry(DOCTOR_ENTRY, outcome);
      // json mode already streams the entry as an `entry_appended` event; raw text there
      // would corrupt the JSONL stream.
      if (ctx.mode === "print") deps.stdout(`${doctorText(outcome)}\n`);
    },
  });
}
