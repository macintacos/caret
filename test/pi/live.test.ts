// The one suite that runs real pi, on Node, against the packed caret package — what the
// injected-runner suites beside it cannot show.
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decisionText, REVIEW_TOOL } from "@oc/review-bridge.ts";
import { daemonClient } from "@test/support/daemon.ts";
import { FAUX_PLAN_TITLE } from "@test/support/pi-faux-provider.ts";
import {
  type PiRun,
  packCaret,
  piSandbox,
  piSessionId,
  requireNode,
  runPi,
  stopPiTree,
  strays,
  waitForReview,
} from "@test/support/pi-live.ts";
import { until } from "@test/support/poll.ts";

requireNode();

const FEEDBACK = "LIVE-CHECK-FEEDBACK: add a rollback step";
const REVIEW_WAIT_MS = 20_000;
const EXIT_WAIT_MS = 15_000;
// Well under SUPERVISOR_WINDOW_MS (src/daemon/lifecycle.ts, ~14 s), `caret review`'s retry
// window against a dead daemon, so the hang case times out while the client is alive.
const HANG_WAIT_MS = 3_000;

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

test("/caret:plan blocks a write outside the plans folder until the plan is approved", async () => {
  const sandbox = piSandbox(root, pkgDir);
  pi = runPi(sandbox, "/caret:plan add a greeting");
  const review = await waitForReview(sandbox, pi, REVIEW_WAIT_MS);
  const res = await daemonClient(sandbox.url).resolve(String(review.id), {
    behavior: "allow",
    version: review.version,
  });
  expect(res.ok).toBe(true);

  expect(await until(() => pi?.proc.exitCode !== null, EXIT_WAIT_MS)).toBe(true);
  const out = await pi.output;
  expect(out.exit).toBe(0);
  const tag = piSessionId(sandbox).slice(-8);
  expect(existsSync(join(sandbox.agentDir, "plans", `greeting-${tag}.md`))).toBe(true);
  expect(readFileSync(join(sandbox.cwd, "greeting.txt"), "utf8")).toBe("hello");
  expect(out.stdout).toContain("steer after approval: no");

  const sessions = join(sandbox.agentDir, "sessions");
  const file = readdirSync(sessions, { recursive: true })
    .map(String)
    .find((f) => f.endsWith(".jsonl"));
  const blocked = readFileSync(join(sessions, String(file)), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .some(
      (e) =>
        e.message?.role === "toolResult" &&
        e.message.toolName === "write" &&
        JSON.stringify(e.message.content).includes(REVIEW_TOOL),
    );
  expect(blocked).toBe(true);
}, 60_000);

test("a daemon that never answers fails the wait and leaves nothing running", async () => {
  const sandbox = piSandbox(root, pkgDir);
  const silent = Bun.listen({
    hostname: "127.0.0.1",
    port: sandbox.port,
    socket: { data() {} },
  });
  try {
    pi = runPi(sandbox, "Plan a change");
    await expect(waitForReview(sandbox, pi, HANG_WAIT_MS)).rejects.toThrow(/^waitFor: timed out$/);
    await stopPiTree(pi, root);
  } finally {
    silent.stop(true);
  }
  // A daemon may win the port once the listener closes.
  await stopPiTree(pi, root);
  expect(await until(() => pi?.proc.exitCode !== null, 2_000)).toBe(true);
  expect(strays(root)).toEqual([]);
}, 60_000);
