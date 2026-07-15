// Daemon-side canonicalization of plan text. Every incoming plan version is
// formatted exactly once, at ingest, before it is stored; the stored text is
// the canonical representation that display, line anchors, and feedback all
// reference, so stored versions are never reformatted afterward. Formatting is
// best-effort: oversized or unparseable input is stored raw with one warn — a
// plan is never lost to the formatter.
//
// Uses prettier's standalone API with an explicit plugins array: no config
// file discovery, no plugin auto-loading, so the output is a pure function of
// this module (plus the exact-pinned prettier version).

import * as markdownPlugin from "prettier/plugins/markdown";
import { format } from "prettier/standalone";

import { type CaretLogger, noopLogger } from "@/lib/log.ts";
import { errorMessage } from "@/lib/types.ts";

/** Inputs above this byte count skip formatting and are stored raw. */
export const MAX_FORMAT_BYTES = 1024 * 1024;

async function prettierFormat(text: string): Promise<string> {
  return format(text, {
    parser: "markdown",
    plugins: [markdownPlugin],
    proseWrap: "always",
    // Under the standalone API only the plugins passed here exist, so embedded
    // formatting stays off: fence content passes through byte-for-byte, and no
    // fence can fail the document over a parser prettier doesn't have.
    embeddedLanguageFormatting: "off",
  });
}

/**
 * Formats plan markdown into its canonical stored form (`proseWrap: "always"`).
 * Never throws: oversized or unparseable input comes back unchanged, with a
 * single warn on `log`. `doFormat` is injectable so tests can pin the failure
 * envelope deterministically.
 */
export async function formatPlanMarkdown(
  plan: string,
  log: CaretLogger = noopLogger,
  doFormat: (text: string) => Promise<string> = prettierFormat,
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
    // First line only: prettier parse errors can carry a code frame, and plan
    // text must never reach a log record under any key.
    const reason = errorMessage(err).split("\n", 1)[0] ?? "";
    log.warn("review", "plan format failed, storing raw", { reason });
    return plan;
  }
}
