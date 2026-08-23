// Daemon-side canonicalization of plan text. Every incoming plan version is
// formatted exactly once, at ingest, before it is stored; the stored text is
// the canonical representation that display, line anchors, and feedback all
// reference, so stored versions are never reformatted afterward. Formatting is
// best-effort and bounded: oversized, unparseable, or over-budget input is
// stored raw with one warn — a plan is never lost to, or delayed by, the
// formatter.
//
// The formatter is rumdl (src/plan/rumdl.ts), downloaded into caret's state dir
// on first use: it reflows prose to caret's 90-col MD013 convention, leaves
// fenced code verbatim, exempts link URLs from the column measurement, and is
// idempotent. `doFormat` stays injectable so tests
// can pin the failure envelope; a missing/failed rumdl throws and is caught here.

import { type CaretLogger, noopLogger } from "@/lib/log.ts";
import { errorMessage } from "@/lib/types.ts";
import { rumdlFormatPlan } from "@/plan/rumdl.ts";

/** Inputs above this byte count skip formatting and are stored raw. */
export const MAX_FORMAT_BYTES = 1024 * 1024;

/** A format that outruns this deadline is abandoned and the input stored raw. */
export const FORMAT_BUDGET_MS = 2000;

/**
 * Formats plan markdown into its canonical stored form (rumdl's 90-col reflow).
 * Never throws and never blocks past `budgetMs`: oversized, unparseable, or
 * over-budget input comes back unchanged, with a single warn on `log`.
 * `doFormat` is injectable so tests can pin the failure envelope
 * deterministically.
 */
export async function formatPlanMarkdown(
  plan: string,
  log: CaretLogger = noopLogger,
  doFormat: (text: string) => Promise<string> = rumdlFormatPlan,
  budgetMs = FORMAT_BUDGET_MS,
): Promise<string> {
  const bytes = Buffer.byteLength(plan, "utf-8");
  if (bytes > MAX_FORMAT_BYTES) {
    log.warn("review", "plan too large to format, storing raw", {
      bytes,
      maxBytes: MAX_FORMAT_BYTES,
    });
    return plan;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`plan format exceeded ${budgetMs}ms`)), budgetMs);
    });
    return await Promise.race([doFormat(plan), deadline]);
  } catch (err) {
    // First line only: a formatter error can carry multi-line detail, and plan
    // text must never reach a log record under any key.
    const reason = errorMessage(err).split("\n", 1)[0] ?? "";
    log.warn("review", "plan format failed, storing raw", { reason });
    return plan;
  } finally {
    // The daemon is long-lived: a resolved format must not leave a timer armed.
    clearTimeout(timer);
  }
}
