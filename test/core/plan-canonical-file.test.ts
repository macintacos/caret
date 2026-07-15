import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendReviewerNotesToPlanFile,
  writeCanonicalPlanFile,
} from "../../src/plan/canonical-file.ts";
import { recordingLog } from "../support/recording-log.ts";

// writeCanonicalPlanFile mirrors caret's canonical plan text back onto the
// on-disk file the agent reads from, so its plan of record matches the review.
// It must be surgical (only an existing regular .md file) and never fatal.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "caret-planfile-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("rewrites an existing .md plan file with the canonical text", () => {
  const path = join(dir, "plan.md");
  writeFileSync(path, "the agent's raw, unwrapped plan text");
  writeCanonicalPlanFile(path, "# Canonical\n\nwrapped\n", recordingLog().log);
  expect(readFileSync(path, "utf8")).toBe("# Canonical\n\nwrapped\n");
});

test("is a no-op when no path is given (agents without a plan file)", () => {
  expect(() => writeCanonicalPlanFile(undefined, "x", recordingLog().log)).not.toThrow();
});

test("refuses a non-.md path, leaving it untouched", () => {
  const path = join(dir, "plan.txt");
  writeFileSync(path, "raw");
  writeCanonicalPlanFile(path, "canonical", recordingLog().log);
  expect(readFileSync(path, "utf8")).toBe("raw");
});

test("does not create a plan file that does not already exist", () => {
  const path = join(dir, "missing.md");
  writeCanonicalPlanFile(path, "canonical", recordingLog().log);
  expect(existsSync(path)).toBe(false);
});

test("is a no-op for a directory path that ends in .md", () => {
  const path = join(dir, "weird.md");
  mkdtempSync(path); // a directory, not a file
  expect(() => writeCanonicalPlanFile(path, "canonical", recordingLog().log)).not.toThrow();
});

test("never throws when the file cannot be written", () => {
  const path = join(dir, "readonly.md");
  writeFileSync(path, "raw");
  chmodSync(path, 0o444);
  // The invariant is that a write failure is swallowed (a plan is never lost to
  // a file-write error). Whether the write actually fails is platform/uid
  // dependent — root ignores the mode — so we only assert the no-throw contract.
  expect(() => writeCanonicalPlanFile(path, "canonical", recordingLog().log)).not.toThrow();
});

// appendReviewerNotesToPlanFile folds an approval's reviewer notes onto the same
// plan-of-record file, as a trailing labeled section, so the agent reads them when
// it proceeds (EXC-791). It shares writeCanonicalPlanFile's surgical guards.

test("appends the reviewer notes section to an existing .md plan file", () => {
  const path = join(dir, "notes-plan.md");
  writeFileSync(path, "# Canonical\n\nwrapped\n");
  appendReviewerNotesToPlanFile(path, "use the retry helper", recordingLog().log);
  const out = readFileSync(path, "utf8");
  // The canonical plan is preserved and the note is appended below it.
  expect(out.startsWith("# Canonical\n\nwrapped\n")).toBe(true);
  expect(out).toContain("## Notes from the user");
  expect(out).toContain("use the retry helper");
});

test("note append is a no-op for a blank note (file untouched)", () => {
  const path = join(dir, "blank-note.md");
  writeFileSync(path, "# Canonical\n");
  appendReviewerNotesToPlanFile(path, "   ", recordingLog().log);
  expect(readFileSync(path, "utf8")).toBe("# Canonical\n");
});

test("note append is a no-op when no path is given", () => {
  expect(() => appendReviewerNotesToPlanFile(undefined, "note", recordingLog().log)).not.toThrow();
});

test("note append refuses a non-.md path, leaving it untouched", () => {
  const path = join(dir, "plan.txt");
  writeFileSync(path, "raw");
  appendReviewerNotesToPlanFile(path, "note", recordingLog().log);
  expect(readFileSync(path, "utf8")).toBe("raw");
});

test("note append does not create a plan file that does not already exist", () => {
  const path = join(dir, "missing-note.md");
  appendReviewerNotesToPlanFile(path, "note", recordingLog().log);
  expect(existsSync(path)).toBe(false);
});
