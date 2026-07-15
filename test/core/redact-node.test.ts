import { expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { redactLogFiles, redactLogText, scrubString, scrubValue } from "../../src/redact/node.ts";

const home = homedir();

// --- scrubString ---

test("scrubString replaces every occurrence of the home directory with ~", () => {
  expect(scrubString(`boom at ${home}/GitLocal/a and ${home}/b`)).toBe(
    "boom at ~/GitLocal/a and ~/b",
  );
});

test("scrubString redacts the username segment of foreign /Users and /home paths, keeping the sub-path", () => {
  expect(scrubString("/Users/alice/projects/x")).toBe("/Users/<redacted>/projects/x");
  expect(scrubString("/home/bob/y")).toBe("/home/<redacted>/y");
  expect(scrubString("at /Users/alice")).toBe("at /Users/<redacted>");
});

test("scrubString leaves path-free strings untouched", () => {
  expect(scrubString("plan approved")).toBe("plan approved");
  expect(scrubString("3fa85f64-5717-4562-b3fc-2c963f66afa6")).toBe(
    "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  );
});

test("scrubString skips home replacement for a degenerate home directory", () => {
  expect(scrubString("/etc/passwd", "/")).toBe("/etc/passwd");
});

// --- scrubValue ---

test("scrubValue scrubs strings recursively through objects and arrays when redaction is on", () => {
  const out = scrubValue({ msg: `${home}/x`, list: [`${home}/y`], n: 7 }, true);
  expect(out).toEqual({ msg: "~/x", list: ["~/y"], n: 7 });
});

test("scrubValue passes strings through when redaction is off", () => {
  const v = { msg: `${home}/x`, cwd: `${home}/proj` };
  expect(scrubValue(v, false)).toEqual(v);
});

test("scrubValue home-scrubs a cwd path under redaction: current home to ~, foreign username censored", () => {
  // cwd is logged raw (it's diagnostic: which project a review came from) and is
  // deliberately NOT a DENY_KEY — the redact toggle is what makes it shareable.
  // This pins that the redact path covers cwd: the current user's home becomes ~,
  // and a foreign home's username is censored, so a shared log leaks neither. It
  // is falsifiable two ways — drop the home scrub and `${home}` survives; add cwd
  // to DENY_KEYS and the value collapses to "<redacted>" instead of scrubbing.
  const out = scrubValue({ cwd: `${home}/GitLocal/proj`, alien: "/Users/alice/x" }, true) as {
    cwd: string;
    alien: string;
  };
  expect(out.cwd).toBe("~/GitLocal/proj");
  expect(out.cwd).not.toContain(home);
  expect(out.alien).toBe("/Users/<redacted>/x");
});

test("scrubValue censors plan, prompt, and feedback keys even when redaction is off", () => {
  const out = scrubValue(
    { plan: "SECRET PLAN BODY", nested: { prompt: "SECRET PROMPT" }, feedback: "too vague" },
    false,
  );
  expect(out).toEqual({
    plan: "<redacted>",
    nested: { prompt: "<redacted>" },
    feedback: "<redacted>",
  });
});

test("scrubValue leaves non-string primitives untouched", () => {
  expect(scrubValue(42, true)).toBe(42);
  expect(scrubValue(true, true)).toBe(true);
  expect(scrubValue(null, true)).toBe(null);
});

test("scrubValue caps recursion depth", () => {
  // 10 levels of nesting, deeper than the cap — the walk must terminate and
  // mark the cut, not recurse forever or return the raw deep value.
  let deep: Record<string, unknown> = { leaf: `${home}/deep` };
  for (let i = 0; i < 10; i++) deep = { n: deep };
  const out = scrubValue(deep, true);
  expect(JSON.stringify(out)).toContain("<depth-capped>");
  expect(JSON.stringify(out)).not.toContain(home);
});

test("scrubValue terminates on cyclic structures instead of hanging", () => {
  const a: Record<string, unknown> = { name: "a" };
  a.self = a;
  const out = scrubValue(a, true) as Record<string, unknown>;
  expect(out.name).toBe("a");
  expect(out.self).toBe("<cyclic>");
});

test("scrubValue walks repeated (shared) references without marking them cyclic", () => {
  const shared = { p: `${home}/x` };
  const out = scrubValue({ a: shared, b: shared }, true);
  expect(out).toEqual({ a: { p: "~/x" }, b: { p: "~/x" } });
});

// --- redactLogText ---

test("redactLogText scrubs NDJSON records and keeps them parseable one per line", () => {
  const rec1 = JSON.stringify({ level: 50, step: "x", msg: `boom at ${home}/src/cli.ts` });
  const rec2 = JSON.stringify({ level: 30, step: "y", cwd: `${home}/proj` });
  const out = redactLogText(`${rec1}\n${rec2}\n`);
  const lines = out.split("\n").filter((l) => l.length > 0);
  expect(lines.length).toBe(2);
  expect(JSON.parse(lines[0]!)).toEqual({ level: 50, step: "x", msg: "boom at ~/src/cli.ts" });
  expect(JSON.parse(lines[1]!)).toEqual({ level: 30, step: "y", cwd: "~/proj" });
});

test("redactLogText scrubs non-JSON lines as raw text", () => {
  const out = redactLogText(`caret: crash near ${home}/x\n`);
  expect(out).toBe("caret: crash near ~/x\n");
});

test("redactLogText never throws on malformed JSON lines and still scrubs them", () => {
  const out = redactLogText(`{not json ${home}/x\n`);
  expect(out).toBe("{not json ~/x\n");
});

test("redactLogText censors denylisted keys in records", () => {
  const out = redactLogText(`${JSON.stringify({ step: "x", plan: "SECRET" })}\n`);
  expect(out).not.toContain("SECRET");
  expect(JSON.parse(out.split("\n")[0]!).plan).toBe("<redacted>");
});

// --- redactLogFiles ---

test("redactLogFiles writes scrubbed 0600 .redacted.log siblings, returns their paths, and leaves originals untouched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "caret-redact-"));
  const original = `${JSON.stringify({ step: "x", msg: `at ${home}/src` })}\nraw ${home}/y\n`;
  const file = join(dir, "caret.log");
  await writeFile(file, original);

  const written = redactLogFiles([file]);

  const sibling = join(dir, "caret.redacted.log");
  expect(written).toEqual([sibling]);
  const scrubbed = readFileSync(sibling, "utf-8");
  expect(scrubbed).not.toContain(home);
  expect(scrubbed).toContain("~/src");
  expect(statSync(sibling).mode & 0o777).toBe(0o600);
  expect(readFileSync(file, "utf-8")).toBe(original); // original untouched
});

test("redactLogFiles skips absent files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "caret-redact-"));
  expect(redactLogFiles([join(dir, "missing.log")])).toEqual([]);
});
