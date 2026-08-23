// formatPlanMarkdown: the daemon-side canonicalization pass applied to every
// incoming plan version at ingest. Pins the rumdl output contract (prose reflowed
// to 90 cols, fences verbatim, idempotent) and the never-throw fallback envelope
// (oversize or unparseable input comes back raw with exactly one warn).
import { expect, test } from "bun:test";

import { recordingLog } from "@test/support/recording-log.ts";
import { formatPlanMarkdown, MAX_FORMAT_BYTES } from "@/plan/markdown.ts";
import { rumdlFormatPlan } from "@/plan/rumdl.ts";

const LONG_PROSE =
  "# Title\n\n" +
  "This paragraph is deliberately written as one very long unwrapped line so that " +
  "rumdl's MD013 reflow has something to normalize when it rewraps the incoming plan " +
  "text into its canonical stored representation.\n";

test("reflows long prose to the canonical 90-col width (rumdl)", async () => {
  const out = await formatPlanMarkdown(LONG_PROSE);
  // The default engine is rumdl, so the stored form is exactly rumdl's reflow.
  expect(out).toBe(await rumdlFormatPlan(LONG_PROSE));
  const lines = out.split("\n");
  expect(lines.length).toBeGreaterThan(3);
  for (const line of lines) expect(line.length).toBeLessThanOrEqual(90);
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

test("a format that outruns its budget returns the raw text with one warn", async () => {
  const { recs, log } = recordingLog();
  const never = () => new Promise<string>(() => {});
  const out = await formatPlanMarkdown(LONG_PROSE, log, never, 20);
  expect(out).toBe(LONG_PROSE);
  expect(recs).toEqual([
    {
      level: "warn",
      step: "review",
      msg: "plan format failed, storing raw",
      extra: { reason: expect.stringMatching(/exceeded 20ms/) },
    },
  ]);
});

test("a format that finishes inside its budget returns formatted text and logs nothing", async () => {
  const { recs, log } = recordingLog();
  const quick = async (text: string) => `${text}formatted\n`;
  const out = await formatPlanMarkdown(LONG_PROSE, log, quick, 20);
  expect(out).toBe(`${LONG_PROSE}formatted\n`);
  expect(recs).toEqual([]);
});
