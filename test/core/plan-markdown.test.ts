// formatPlanMarkdown: the daemon-side canonicalization pass applied to every
// incoming plan version at ingest. Pins the prettier output contract (prose
// wrapped, fences verbatim, idempotent) and the never-throw fallback envelope
// (oversize or unparseable input comes back raw with exactly one warn).
import { expect, test } from "bun:test";
import { MAX_FORMAT_BYTES, formatPlanMarkdown } from "../../src/plan-markdown.ts";
import { recordingLog } from "../support/recording-log.ts";

const LONG_PROSE =
  "# Title\n\n" +
  "This paragraph is deliberately written as one very long unwrapped line so that " +
  "prettier's proseWrap always setting has something to wrap when it normalizes the " +
  "incoming plan text into its canonical stored representation.\n";

test("wraps long prose lines (proseWrap: always)", async () => {
  const out = await formatPlanMarkdown(LONG_PROSE);
  const lines = out.split("\n");
  expect(lines.length).toBeGreaterThan(3);
  for (const line of lines) expect(line.length).toBeLessThanOrEqual(80);
});

test("format(format(text)) === format(text) for representative inputs", async () => {
  const inputs = [
    LONG_PROSE,
    "## Heading\n\n- item one\n- item two\n  - nested item with a [link](https://example.com)\n",
    "Setext heading\n===\n\nParagraph with *emphasis* and `inline code`.\n",
    "```ts\nconst x = 1;\n```\n\ntrailing prose\n",
    "1. first\n2. second\n3. third\n",
  ];
  for (const input of inputs) {
    const once = await formatPlanMarkdown(input);
    expect(await formatPlanMarkdown(once)).toBe(once);
  }
});

test("fenced code block content is preserved verbatim", async () => {
  const fence =
    "```text\n" +
    "a deliberately very long line of ASCII art that must never be wrapped because fence content is not prose at all\n" +
    "  indentation   and   spacing   kept\n" +
    "```";
  const out = await formatPlanMarkdown(`intro\n\n${fence}\n`);
  expect(out).toContain(fence);
});

test("empty input formats without logging", async () => {
  const { recs, log } = recordingLog();
  const out = await formatPlanMarkdown("", log);
  expect(typeof out).toBe("string");
  expect(recs).toEqual([]);
});

test("input above the size cap is returned raw with one warn", async () => {
  const { recs, log } = recordingLog();
  const big = `# Big\n\n${"x".repeat(MAX_FORMAT_BYTES)}\n`;
  const out = await formatPlanMarkdown(big, log);
  expect(out).toBe(big);
  expect(recs).toEqual([
    {
      level: "warn",
      step: "review",
      msg: "plan too large to format, storing raw",
      extra: { bytes: Buffer.byteLength(big, "utf-8"), maxBytes: MAX_FORMAT_BYTES },
    },
  ]);
});

test("a formatter failure returns the raw text with one warn", async () => {
  const { recs, log } = recordingLog();
  const boom = async () => {
    throw new Error("Unexpected token (1:1)\n> 1 | the plan body must never reach a log");
  };
  const out = await formatPlanMarkdown(LONG_PROSE, log, boom);
  expect(out).toBe(LONG_PROSE);
  expect(recs).toEqual([
    {
      level: "warn",
      step: "review",
      msg: "plan format failed, storing raw",
      extra: { reason: "Unexpected token (1:1)" },
    },
  ]);
});

test("a non-Error throw still falls back cleanly", async () => {
  const { recs, log } = recordingLog();
  const boom = async () => {
    throw "string failure";
  };
  const out = await formatPlanMarkdown("plain text", log, boom);
  expect(out).toBe("plain text");
  expect(recs).toHaveLength(1);
  expect(recs[0]?.extra).toEqual({ reason: "string failure" });
});
