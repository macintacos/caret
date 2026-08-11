// Test preload (registered in bunfig.toml's `[test] preload`): raise the unit
// lane's per-test deadline above bun's 5000ms default (EXC-1056).
//
// 5000ms is a quiet-host number, and the lane's own gate is not a quiet host:
// inside `mise run preflight`, lint, both builds, the Playwright suite and smoke
// all run alongside it. The tests that break first are not the CPU-heavy ones but
// the SPAWN-heavy ones — `test/scripts/dev-driver.test.ts` posts several plan
// versions through the real submit → reflow → store path, and each reflow spawns
// rumdl. Process spawn is where a saturated host stretches worst: those tests
// measure a few hundred ms standalone and cross 5s in the gate, better than 10x,
// against a suite average nearer 2.8x.
//
// A deadline is not a retry. The test still runs once and still asserts the same
// thing, so nothing is hidden; the budget only stops the suite asserting that the
// machine was idle. It stays finite so a genuine hang is still bounded, and well
// under the one test that sets its own (the shiki pattern sweep's 60s), so that
// literal still says "this one is intrinsically slower" rather than merely
// echoing the default.
//
// Set HERE rather than as a `--timeout` flag on the task, which was tried and
// reverted: the lane has three entry points — `mise run test`, `package.json`'s
// `test`, and a bare `bun test <file>` — a flag reaches only the one it is written
// on, and a test green under one invocation and red under another is worse than
// the coarser default it buys. A preload runs under all three.
import { setDefaultTimeout } from "bun:test";

setDefaultTimeout(30_000);
