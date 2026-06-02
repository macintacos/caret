import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logError } from "../src/log.ts";
import { daemonLogFile, logFile } from "../src/paths.ts";

let home: string;
let savedXdg: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "caret-log-"));
  savedXdg = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = home;
});
afterEach(async () => {
  if (savedXdg === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = savedXdg;
  await rm(home, { recursive: true, force: true });
});

test("logFile and daemonLogFile resolve under the caret state dir", () => {
  expect(logFile()).toBe(join(home, "caret", "caret.log"));
  expect(daemonLogFile()).toBe(join(home, "caret", "daemon.log"));
});

test("logError writes a sentinel-delimited entry with step, message, and stack", () => {
  logError("longPoll", new Error("boom"));
  const body = readFileSync(logFile(), "utf-8");
  expect(body).toMatch(/^=== caret error \d{4}-\d\d-\d\dT[\d:.]+Z step=longPoll ===$/m);
  expect(body).toContain("boom");
  expect(body).toMatch(/\n\s+at /); // a real stack frame
});

test("logError records the error cause chain when present", () => {
  logError("ensureDaemon", new Error("outer", { cause: new Error("inner-root") }));
  const body = readFileSync(logFile(), "utf-8");
  expect(body).toContain("outer");
  expect(body).toContain("inner-root");
});

test("logError records sessionId and cwd context when provided", () => {
  logError("runReview", new Error("x"), { sessionId: "sess-42", cwd: "/tmp/proj" });
  const body = readFileSync(logFile(), "utf-8");
  expect(body).toContain("sess-42");
  expect(body).toContain("/tmp/proj");
});

test("logError appends across calls rather than truncating", () => {
  logError("first", new Error("one"));
  logError("second", new Error("two"));
  const body = readFileSync(logFile(), "utf-8");
  expect(body.match(/^=== caret error /gm)?.length).toBe(2);
  expect(body).toContain("step=first");
  expect(body).toContain("step=second");
});

test("logError creates the state dir 0700 and the log file 0600", () => {
  logError("perm", new Error("p"));
  expect(statSync(join(home, "caret")).mode & 0o777).toBe(0o700);
  expect(statSync(logFile()).mode & 0o777).toBe(0o600);
});

test("logError terminates on a cyclic cause chain instead of hanging", () => {
  const a = new Error("a-err");
  const b = new Error("b-err");
  (a as Error).cause = b;
  (b as Error).cause = a; // cycle: a -> b -> a
  logError("cyclic", a);
  const body = readFileSync(logFile(), "utf-8");
  expect(body).toContain("step=cyclic");
  expect(body).toContain("a-err");
  expect(body).toContain("b-err");
});

test("logError swallows write failures instead of throwing", async () => {
  // Make the state-dir parent a regular file so mkdir/open both fail (ENOTDIR).
  const blocker = join(home, "blocker");
  await writeFile(blocker, "not a dir");
  process.env.XDG_STATE_HOME = join(blocker, "nested");
  expect(() => logError("doomed", new Error("nope"))).not.toThrow();
});
