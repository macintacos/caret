import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDaemonLogger,
  logDebug,
  logError,
  logInfo,
  logWarn,
  setLogLevel,
  setRedact,
} from "../src/log.ts";
import { daemonLogFile, logFile } from "../src/paths.ts";

let home: string;
let savedXdg: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "caret-log-"));
  savedXdg = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = home;
});
afterEach(async () => {
  setLogLevel("info"); // reset so level changes don't leak across tests
  setRedact(false); // reset so redaction toggles don't leak across tests
  if (savedXdg === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = savedXdg;
  await rm(home, { recursive: true, force: true });
});

/** Read caret.log and return its parsed NDJSON records (one per non-blank line). */
function records(path = logFile()): Record<string, unknown>[] {
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

test("logFile and daemonLogFile resolve under the caret state dir", () => {
  expect(logFile()).toBe(join(home, "caret", "caret.log"));
  expect(daemonLogFile()).toBe(join(home, "caret", "daemon.log"));
});

test("logError writes a single-line JSON error record with step, msg, and a real stack", () => {
  logError("longPoll", new Error("boom"));
  const recs = records();
  expect(recs.length).toBe(1);
  const r = recs[0];
  expect(r.level).toBe(50);
  expect(r.step).toBe("longPoll");
  expect(r.msg).toBe("boom");
  const err = r.err as { message: string; stack: string };
  expect(err.message).toBe("boom");
  expect(err.stack).toMatch(/\n\s+at /); // a real stack frame
});

test("logError serializes a nested cause chain", () => {
  logError("ensureDaemon", new Error("outer", { cause: new Error("inner-root") }));
  const r = records()[0];
  const err = r.err as { message: string; cause: { message: string } };
  expect(err.message).toBe("outer");
  expect(err.cause.message).toBe("inner-root");
});

test("logError terminates on a cyclic cause chain instead of hanging", () => {
  const a = new Error("a-err");
  const b = new Error("b-err");
  (a as Error).cause = b;
  (b as Error).cause = a; // cycle: a -> b -> a
  logError("cyclic", a);
  const body = readFileSync(logFile(), "utf-8");
  // One record written, both messages present, no hang.
  expect(records().length).toBe(1);
  expect(body).toContain("a-err");
  expect(body).toContain("b-err");
});

test("logError records sessionId and cwd context when provided", () => {
  logError("runReview", new Error("x"), { sessionId: "sess-42", cwd: "/tmp/proj" });
  const r = records()[0];
  expect(r.sessionId).toBe("sess-42");
  expect(r.cwd).toBe("/tmp/proj");
  expect(r.step).toBe("runReview");
});

test("logError handles a non-Error value, using the string as msg", () => {
  logError("stringy", "just a string");
  const r = records()[0];
  expect(r.level).toBe(50);
  expect(r.step).toBe("stringy");
  expect(r.msg).toBe("just a string");
  expect(r.err).toBeUndefined();
});

test("logInfo, logWarn, and logDebug write level 30/40/20 records with step, msg, and extra", () => {
  setLogLevel("debug"); // so the debug record is not gated out
  logInfo("review", "created", { id: "r1" });
  logWarn("port", "in use", { port: 42718 });
  logDebug("trace", "detail", { n: 7 });
  const recs = records();
  expect(recs.length).toBe(3);
  expect(recs[0]).toMatchObject({ level: 30, step: "review", msg: "created", id: "r1" });
  expect(recs[1]).toMatchObject({ level: 40, step: "port", msg: "in use", port: 42718 });
  expect(recs[2]).toMatchObject({ level: 20, step: "trace", msg: "detail", n: 7 });
});

test("at the default info level, logDebug writes nothing", () => {
  logDebug("trace", "hidden");
  logInfo("review", "visible");
  const recs = records();
  expect(recs.length).toBe(1);
  expect(recs[0].msg).toBe("visible");
});

test("after setLogLevel('warn'), logInfo is gated but logWarn and logError emit", () => {
  setLogLevel("warn");
  logInfo("info", "gated");
  logWarn("warn", "shown");
  logError("err", new Error("also shown"));
  const recs = records();
  expect(recs.length).toBe(2);
  expect(recs.map((r) => r.level)).toEqual([40, 50]);
});

test("after setLogLevel('debug'), logDebug emits", () => {
  setLogLevel("debug");
  logDebug("trace", "now visible");
  const recs = records();
  expect(recs.length).toBe(1);
  expect(recs[0]).toMatchObject({ level: 20, msg: "now visible" });
});

test("records append across calls rather than truncating", () => {
  logInfo("first", "one");
  logInfo("second", "two");
  const recs = records();
  expect(recs.length).toBe(2);
  expect(recs[0].step).toBe("first");
  expect(recs[1].step).toBe("second");
});

test("logging creates the state dir 0700 and the log file 0600", () => {
  logError("perm", new Error("p"));
  expect(statSync(join(home, "caret")).mode & 0o777).toBe(0o700);
  expect(statSync(logFile()).mode & 0o777).toBe(0o600);
});

test("logging swallows write failures instead of throwing", async () => {
  // Make the state-dir parent a regular file so mkdir/open both fail (ENOTDIR).
  const blocker = join(home, "blocker");
  await writeFile(blocker, "not a dir");
  process.env.XDG_STATE_HOME = join(blocker, "nested");
  expect(() => logError("doomed", new Error("nope"))).not.toThrow();
  expect(() => logInfo("doomed", "nope")).not.toThrow();
});

test("createDaemonLogger writes NDJSON with pid in base and respects the level thunk", () => {
  const dest = join(home, "daemon-test.log");
  let level: "debug" | "info" | "warn" | "error" = "info";
  const log = createDaemonLogger(() => level, dest);

  log.debug("boot", "hidden at info");
  log.info("review", "review created: r1", { id: "r1" });

  level = "debug"; // hot reload: subsequent emits honour the new level
  log.debug("boot", "now visible");

  const recs = records(dest);
  expect(recs.length).toBe(2);
  expect(recs[0]).toMatchObject({ level: 30, step: "review", msg: "review created: r1", id: "r1" });
  expect(recs[0].pid).toBe(process.pid);
  expect(recs[1]).toMatchObject({ level: 20, step: "boot", msg: "now visible" });
});

// --- record provenance (EXC-445) ---

test("hook records carry source 'hook'", () => {
  logInfo("review", "created");
  expect(records()[0]).toMatchObject({ source: "hook" });
});

test("daemon records carry source 'daemon'", () => {
  const dest = join(home, "daemon-src.log");
  const log = createDaemonLogger(() => "info", dest);
  log.info("listen", "listening");
  expect(records(dest)[0]).toMatchObject({ source: "daemon" });
});

test("an explicit extra.source wins over the logger's own tag", () => {
  // The UI bridge forwards browser events through the daemon logger with
  // source="ui" already set — the per-record value must not be clobbered.
  const dest = join(home, "daemon-ui-src.log");
  const log = createDaemonLogger(() => "info", dest);
  log.info("ui", "ui loaded", { source: "ui" });
  expect(records(dest)[0]).toMatchObject({ source: "ui" });
});

// --- caller location (EXC-451) ---

// Stack-captured repo-relative `path:line` of the emitting call site. The
// regex pins the file to this test (so we know the frame walk skipped src/log.ts
// and landed on the real caller) and the trailing line number.
const CALLER = /^test\/log\.test\.ts:\d+$/;

test("hook records carry the caller location", () => {
  logInfo("review", "created");
  expect(records()[0].caller).toMatch(CALLER);
});

test("daemon records carry the caller location", () => {
  const dest = join(home, "daemon-caller.log");
  const log = createDaemonLogger(() => "info", dest);
  log.info("listen", "listening");
  expect(records(dest)[0].caller).toMatch(CALLER);
});

test("error records carry the caller location", () => {
  logError("boom", new Error("x"));
  expect(records()[0].caller).toMatch(CALLER);
});

test("bridged records (explicit extra.source) omit the caller location", () => {
  const dest = join(home, "daemon-bridged.log");
  const log = createDaemonLogger(() => "info", dest);
  log.info("ui", "ui loaded", { source: "ui" });
  const r = records(dest)[0];
  expect(r.source).toBe("ui");
  expect(r.caller).toBeUndefined();
});

test("with redaction on, the caller stays the repo-relative path", () => {
  setRedact(true);
  logInfo("review", "created");
  expect(records()[0].caller).toMatch(CALLER);
});

test("a null extra.source reads as unset: own tag and caller attach", () => {
  // == null in fields() preserves the replaced ??= semantics — only a real
  // string source (the bridged-UI signal) suppresses the caller stamp.
  const dest = join(home, "daemon-null-source.log");
  const log = createDaemonLogger(() => "info", dest);
  log.info("listen", "listening", { source: null });
  const r = records(dest)[0];
  expect(r.source).toBe("daemon");
  expect(r.caller).toMatch(CALLER);
});

// --- timestamps ---

test("records carry an ISO 8601 UTC time with the date", () => {
  logInfo("review", "created");
  const dest = join(home, "daemon-time.log");
  createDaemonLogger(() => "info", dest).info("listen", "listening");
  // Full date + ms precision + the trailing Z that pins the zone to UTC.
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  expect(records()[0].time).toMatch(iso);
  expect(records(dest)[0].time).toMatch(iso);
});

// --- redaction (EXC-399) ---

const realHome = homedir();

test("by default (redaction off), home paths pass through raw", () => {
  logError("raw", new Error(`boom at ${realHome}/src/cli.ts`), { cwd: `${realHome}/proj` });
  const body = readFileSync(logFile(), "utf-8");
  expect(body).toContain(realHome);
});

test("with redaction on, identifiable strings never reach the file but debuggability survives", () => {
  setRedact(true);
  logError("runReview", new Error(`failed reading ${realHome}/.config/caret/config.toml`), {
    cwd: `${realHome}/GitLocal/proj`,
    plan: "SECRET PLAN BODY",
  });
  logInfo("settings", `settings: reading ${realHome}/.config/caret/config.toml`);
  const body = readFileSync(logFile(), "utf-8");
  expect(body).not.toContain(realHome);
  expect(body).not.toContain("SECRET PLAN BODY");
  const [errRec, infoRec] = records();
  expect(errRec.step).toBe("runReview");
  expect(errRec.msg).toBe("failed reading ~/.config/caret/config.toml");
  expect(errRec.cwd).toBe("~/GitLocal/proj");
  expect(errRec.plan).toBe("<redacted>");
  const err = errRec.err as { message: string; stack: string };
  expect(err.message).toBe("failed reading ~/.config/caret/config.toml");
  expect(err.stack).toMatch(/\n\s+at /); // stack shape preserved
  expect(infoRec.msg).toBe("settings: reading ~/.config/caret/config.toml");
});

test("with redaction on, a nested cause chain is scrubbed at depth", () => {
  setRedact(true);
  logError("deep", new Error(`outer ${realHome}/a`, { cause: new Error(`inner ${realHome}/b`) }));
  const err = records()[0].err as { message: string; cause: { message: string } };
  expect(err.message).toBe("outer ~/a");
  expect(err.cause.message).toBe("inner ~/b");
});

test("plan and prompt extras are censored even with redaction off", () => {
  logInfo("decision", `at ${realHome}/x`, { plan: "SECRET PLAN", prompt: "SECRET PROMPT" });
  const r = records()[0];
  expect(r.plan).toBe("<redacted>");
  expect(r.prompt).toBe("<redacted>");
  expect(r.msg).toContain(realHome); // the toggle is off: paths pass through raw
});

test("a cyclic extra object never throws and writes one record", () => {
  setRedact(true);
  const extra: Record<string, unknown> = { ok: "fine" };
  extra.self = extra;
  expect(() => logInfo("cyclicExtra", "still logs", extra)).not.toThrow();
  const recs = records();
  expect(recs.length).toBe(1);
  expect(recs[0].msg).toBe("still logs");
  // The walk cuts the cycle with a marker. Its exact nesting depends on the
  // emit path's `{ ...extra }` copy (the copy is a new root, so the original
  // is first re-seen one level down) — assert the cut, not the position.
  expect(JSON.stringify(recs[0].self)).toContain("<cyclic>");
});

test("createDaemonLogger redacts when its redact thunk returns true", () => {
  const dest = join(home, "daemon-redact.log");
  const log = createDaemonLogger(() => "info", dest, () => true);
  log.error("request", new Error(`kaboom at ${realHome}/srv`), { cwd: `${realHome}/proj` });
  const body = readFileSync(dest, "utf-8");
  expect(body).not.toContain(realHome);
  const r = records(dest)[0];
  expect(r.msg).toBe("kaboom at ~/srv");
  expect(r.cwd).toBe("~/proj");
});

test("createDaemonLogger error method serializes an Error", () => {
  const dest = join(home, "daemon-err.log");
  const log = createDaemonLogger(() => "info", dest);
  log.error("request", new Error("kaboom"));
  const r = records(dest)[0];
  expect(r.level).toBe(50);
  expect(r.step).toBe("request");
  expect(r.msg).toBe("kaboom");
  expect((r.err as { message: string }).message).toBe("kaboom");
});
