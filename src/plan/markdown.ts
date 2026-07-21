// Daemon-side canonicalization of plan text. Every incoming plan version is
// formatted exactly once, at ingest, before it is stored; the stored text is
// the canonical representation that display, line anchors, and feedback all
// reference, so stored versions are never reformatted afterward. Formatting is
// best-effort: oversized or unparseable input is stored raw with one warn — a
// plan is never lost to the formatter.
//
// The formatter is rumdl (src/plan/rumdl.ts), downloaded into caret's state dir
// on first use: it reflows prose to caret's 90-col MD013 convention, leaves
// fenced code verbatim, and is idempotent. `doFormat` stays injectable so tests
// can pin the failure envelope; a missing/failed rumdl throws and is caught here.

import { type CaretLogger, noopLogger } from "@/lib/log.ts";
import { errorMessage } from "@/lib/types.ts";
import { rumdlFormatPlan } from "@/plan/rumdl.ts";

/** Inputs above this byte count skip formatting and are stored raw. */
export const MAX_FORMAT_BYTES = 1024 * 1024;

/**
 * Formats plan markdown into its canonical stored form (rumdl's 90-col reflow).
 * Never throws: oversized or unparseable input comes back unchanged, with a
 * single warn on `log`. `doFormat` is injectable so tests can pin the failure
 * envelope deterministically.
 */
export async function formatPlanMarkdown(
  plan: string,
  log: CaretLogger = noopLogger,
  doFormat: (text: string) => Promise<string> = rumdlFormatPlan,
): Promise<string> {
  const bytes = Buffer.byteLength(plan, "utf-8");
  if (bytes > MAX_FORMAT_BYTES) {
    log.warn("review", "plan too large to format, storing raw", {
      bytes,
      maxBytes: MAX_FORMAT_BYTES,
    });
    return plan;
  }
  try {
    return await doFormat(plan);
  } catch (err) {
    // First line only: a formatter error can carry multi-line detail, and plan
    // text must never reach a log record under any key.
    const reason = errorMessage(err).split("\n", 1)[0] ?? "";
    log.warn("review", "plan format failed, storing raw", { reason });
    return plan;
  }
}
