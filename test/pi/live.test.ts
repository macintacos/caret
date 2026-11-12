// The one suite that runs real pi, on Node, against the packed caret package — what the
// injected-runner suites beside it cannot show.
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decisionText, REVIEW_TOOL } from "@bridge/review-bridge.ts";
import { DOCTOR_ENTRY, FAILED_VERDICT, PASSED_VERDICT } from "@piext/doctor.ts";
import { sessionTag } from "@piext/plan.ts";
import { daemonClient } from "@test/support/daemon.ts";
import { withEnv } from "@test/support/env.ts";
import { FAUX_PLAN_TITLE } from "@test/support/pi-faux-provider.ts";
import {
  type PiRun,
  packCaret,
  piSandbox,
  piSessionEntries,
  piSessionId,
  requireNode,
  runPi,
  stopPiTree,
  strays,
  waitForReview,
} from "@test/support/pi-live.ts";
import { until } from "@test/support/poll.ts";
import { rumdlBin } from "@/config/paths.ts";

requireNode();

const FEEDBACK = "LIVE-CHECK-FEEDBACK: add a rollback step";
const REVIEW_WAIT_MS = 20_000;
const EXIT_WAIT_MS = 15_000;
const DOCTOR_EXIT_WAIT_MS = 45_000;

let root: string;
let pkgDir: string;
let pi: PiRun | undefined;

beforeAll(() => {
  // macOS tmpdir() sits behind the /var symlink; bin/caret resolves it, so strays()' pgrep needs the real path.
  root = realpathSync(mkdtempSync(join(tmpdir(), "caret-pi-live-")));
  pkgDir = packCaret(root);
}, 60_000);

afterEach(async () => {
  await stopPiTree(pi, root);
  pi = undefined;
}, 10_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

test("a deny's feedback reaches pi's model as the tool result", async () => {
  const sandbox = piSandbox(root, pkgDir);
  pi = runPi(sandbox, "Plan a change");
  const review = await waitForReview(sandbox, pi, REVIEW_WAIT_MS);
  expect(review.sessionId).toBe(piSessionId(sandbox));
  expect(review.title).toBe(FAUX_PLAN_TITLE);
  // The daemon reflowed the plan with the run's own rumdl, so the suite stays offline.
  expect(existsSync(withEnv({ XDG_STATE_HOME: sandbox.env.XDG_STATE_HOME }, rumdlBin))).toBe(false);

  const res = await daemonClient(sandbox.url).resolve(String(review.id), {
    behavior: "deny",
    feedback: FEEDBACK,
    version: review.version,
  });
  expect(res.ok).toBe(true);

  // `until`, not a Promise.race with a throwing sleep: the losing sleep would reject
  // unhandled 15 s later and fail whichever test is running then.
  expect(await until(() => pi?.proc.exitCode !== null, EXIT_WAIT_MS)).toBe(true);
  const out = await pi.output;
  expect(out.exit).toBe(0);
  expect(out.stdout).toContain(decisionText({ behavior: "deny", feedback: FEEDBACK }, REVIEW_TOOL));
  expect(out.stdout).toContain(FEEDBACK);
}, 60_000);

test("/caret <task> blocks a write outside the plans folder until the plan is approved", async () => {
  const sandbox = piSandbox(root, pkgDir);
  pi = runPi(sandbox, "/caret add a greeting");
  const review = await waitForReview(sandbox, pi, REVIEW_WAIT_MS);
  const res = await daemonClient(sandbox.url).resolve(String(review.id), {
    behavior: "allow",
    version: review.version,
  });
  expect(res.ok).toBe(true);

  expect(await until(() => pi?.proc.exitCode !== null, EXIT_WAIT_MS)).toBe(true);
  const out = await pi.output;
  expect(out.exit).toBe(0);
  const tag = sessionTag(piSessionId(sandbox));
  expect(existsSync(join(sandbox.agentDir, "plans", `greeting-${tag}.md`))).toBe(true);
  expect(readFileSync(join(sandbox.cwd, "greeting.txt"), "utf8")).toBe("hello");
  expect(out.stdout).toContain("steer after approval: no");

  const blocked = piSessionEntries(sandbox).some((e) => {
    const m = (e as { message?: { role?: string; toolName?: string; content?: unknown } }).message;
    return (
      m?.role === "toolResult" &&
      m.toolName === "write" &&
      JSON.stringify(m.content).includes(REVIEW_TOOL)
    );
  });
  expect(blocked).toBe(true);
}, 60_000);

test("/caret demo sends the packaged template and opens a review", async () => {
  const sandbox = piSandbox(root, pkgDir);
  pi = runPi(sandbox, "/caret demo");
  const review = await waitForReview(sandbox, pi, REVIEW_WAIT_MS);
  expect(review.title).toBe(FAUX_PLAN_TITLE);
  const res = await daemonClient(sandbox.url).resolve(String(review.id), {
    behavior: "allow",
    version: review.version,
  });
  expect(res.ok).toBe(true);

  expect(await until(() => pi?.proc.exitCode !== null, EXIT_WAIT_MS)).toBe(true);
  expect((await pi.output).exit).toBe(0);

  const sentTemplate = piSessionEntries(sandbox).some((e) => {
    const m = (e as { message?: { role?: string; content?: unknown } }).message;
    const text = JSON.stringify(m?.content ?? "");
    return (
      m?.role === "user" &&
      text.includes("# Add a getting-started guide") &&
      text.includes(REVIEW_TOOL)
    );
  });
  expect(sentTemplate).toBe(true);
}, 60_000);

test("/caret doctor prints its report and keeps it out of the model's context", async () => {
  const sandbox = piSandbox(root, pkgDir);
  pi = runPi(sandbox, "/caret doctor", "doctor check");
  expect(await until(() => pi?.proc.exitCode !== null, DOCTOR_EXIT_WAIT_MS)).toBe(true);
  const out = await pi.output;
  expect(out.exit).toBe(0);
  expect(out.stdout).toMatch(/caret doctor \d/);
  expect([PASSED_VERDICT, FAILED_VERDICT].some((v) => out.stdout.includes(v))).toBe(true);
  expect(out.stdout).toContain("doctor in context: no");
  // caret is installed in pi only, so this reads true only under CARET_AGENT=pi.
  expect(out.stdout).toMatch(/pluginEnabled\s+true/);

  const appended = piSessionEntries(sandbox).some((e) => {
    const entry = e as { type?: string; customType?: string };
    return entry.type === "custom" && entry.customType === DOCTOR_ENTRY;
  });
  expect(appended).toBe(true);
}, 90_000);

test("a daemon that never answers fails the wait and leaves nothing running", async () => {
  const sandbox = piSandbox(root, pkgDir);
  const silent = Bun.listen({
    hostname: "127.0.0.1",
    port: sandbox.port,
    socket: { data() {} },
  });
  try {
    pi = runPi(sandbox, "Plan a change");
    // Once the packed `caret review` is up and stuck on the silent port, a single probe
    // (budget 0) shows the wait fails instead of hanging, and teardown meets a live client.
    const client = join(pkgDir, "dist", "cli.js review");
    expect(await until(() => strays(client).length > 0, REVIEW_WAIT_MS)).toBe(true);
    await expect(waitForReview(sandbox, pi, 0)).rejects.toThrow(/^waitFor: timed out$/);
    await stopPiTree(pi, root);
  } finally {
    silent.stop(true);
  }
  // A daemon may win the port once the listener closes.
  await stopPiTree(pi, root);
  expect(await until(() => pi?.proc.exitCode !== null, 2_000)).toBe(true);
  expect(strays(root)).toEqual([]);
}, 60_000);
