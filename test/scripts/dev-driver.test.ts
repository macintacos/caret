import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";

import { bootDaemon, type TestDaemon } from "@test/support/daemon.ts";
import { setupTempStateDir } from "@test/support/env.ts";
import { waitFor } from "@test/support/poll.ts";
import { expectNeverLogsBody } from "@test/support/redaction.ts";
import { codeBlockRanges } from "@ui/src/lib/diffview/codeBlocks.ts";
import { EXCERPT_RADIUS, MAX_CITED_SPAN_LINES, PLAN_REJECTED_MESSAGE } from "@/config/constants.ts";
import { setLogLevel } from "@/lib/log.ts";
import { hasUntaggedCodeBlock } from "@/plan/format.ts";
import { runReview } from "@/review/orchestrate.ts";
import {
  assertDevEnv,
  bootstrapReview,
  devReviewDeps,
  runExtraReview,
  runExtraSeeder,
} from "@/tasks/dev/driver.ts";
import {
  appendRevision,
  DEFAULT_NUM_VERSIONS,
  DEMO_COMMENTS,
  DEV_FIXTURES,
  DEV_SESSION,
  demoAnnotations,
  demoVersions,
  extraPlan,
  hookStdin,
  nextPlan,
  parseNumVersions,
  parsePositiveInt,
} from "@/tasks/dev/protocol.ts";

// Each fixture's final ("current") plan — read independently here so the
// assertions don't lean on the driver's own loader.
const DEV_DIR = `${import.meta.dir}/../../scripts/tasks/dev`;
const fixtureText = (f: { file: string }) => Bun.file(`${DEV_DIR}/${f.file}`).text();
// The primary fixture: the stress-test plan every single-fixture case below uses.
const PRIMARY = DEV_FIXTURES[0]!;
const PLAN_V1 = await fixtureText(PRIMARY);

// Lines that differ positionally between two same-shaped texts — lets a test
// assert a change is narrowly targeted (no lines added or removed, one rewritten).
function differingLines(a: string, b: string): string[] {
  const la = a.split("\n");
  const lb = b.split("\n");
  const out: string[] = [];
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) out.push(lb[i] ?? la[i] ?? "");
  }
  return out;
}

// Point the state dir at the per-test temp dir so the hook logging that
// runReview performs lands in a disposable caret.log, not the real one — the
// daemon's store roots there too, so its caret.log is the one the tests read.
const stateDir = setupTempStateDir("caret-driver-");
let dir: string;
let d: TestDaemon;
let base: string;

// Boot a real in-process daemon (no browser, no spawned process).
async function boot() {
  d = await bootDaemon(dir);
  base = d.url;
}

// Simulate the browser's decision (the UI's POST /resolve).
async function resolve(id: string, behavior: "allow" | "deny", feedback?: string) {
  await d.resolve(id, { behavior, feedback });
}

async function clientReview(id: string) {
  return (await d.getReview(id)) as unknown as {
    currentPlan: string;
    version: number;
    status: string;
    sessionId: string;
  };
}

beforeEach(() => {
  dir = stateDir();
});
afterEach(() => {
  setLogLevel("info"); // undo any per-test level change
  d?.stop();
});

// ---- DEV_SESSION (EXC-461) ----

test("DEV_SESSION is per-instance: suffixed, never the bare caret-dev", () => {
  // Two dev sessions deliberately sharing one daemon must not collide on
  // session identity — the pid suffix makes each driver process its own session.
  expect(DEV_SESSION.startsWith("caret-dev-")).toBe(true);
  expect(DEV_SESSION).not.toBe("caret-dev");
});

// ---- hookStdin ----

test("hookStdin shapes the PermissionRequest stdin the hook parses", () => {
  const parsed = JSON.parse(hookStdin("# P")) as {
    session_id: string;
    cwd: string;
    tool_input: { plan: string };
  };
  expect(parsed.session_id).toBe(DEV_SESSION);
  expect(parsed.cwd).toBe(process.cwd());
  expect(parsed.tool_input.plan).toBe("# P");
});

test("hookStdin takes an explicit session id for extra reviews", () => {
  const parsed = JSON.parse(hookStdin("# P", "caret-dev-extra-1")) as { session_id: string };
  expect(parsed.session_id).toBe("caret-dev-extra-1");
});

test("hookStdin takes an explicit cwd, so a recording never shows a real path", () => {
  // The cwd rides the top bar. The `assets` task (EXC-805) records the UI into a
  // committed .webm, so it hands a fabricated path here rather than leaking
  // whichever checkout the generator happened to run from.
  const parsed = JSON.parse(hookStdin("# P", "s", "~/acme-web")) as { cwd: string };
  expect(parsed.cwd).toBe("~/acme-web");
});

// ---- seed fixture invariant (EXC-556) ----

test("the seeded fixture has no untagged code blocks", () => {
  // The stress-test seed (scripts/tasks/dev/fake-plan.md) deliberately exercises many
  // code languages; every fence must carry a language tag or the hook's
  // plan-format gate would deny it. This is also why appendRevision over the
  // fixture stays untagged-free below.
  expect(hasUntaggedCodeBlock(PLAN_V1)).toBe(false);
});

// ---- extraPlan ----

test("extraPlan retitles the h1 so the extra review is distinguishable", () => {
  // Review titles derive from the plan's first heading (src/review/threading.ts), so
  // the retitle is what the switcher and the notification body display.
  const out = extraPlan("# Widget Cache Refactor\n\nbody", 2);
  expect(out).toStartWith("# Widget Cache Refactor — extra 2\n");
  expect(out).toContain("body");
});

// ---- appendRevision ----

test("appendRevision keeps the prior plan and quotes the feedback under a Revision N heading", () => {
  const out = appendRevision("# Plan body", "use a monotonic clock", 1);
  expect(out).toStartWith("# Plan body");
  expect(out).toContain("## Revision 1");
  expect(out).toContain("use a monotonic clock");
});

test("appendRevision never introduces untagged code blocks, even for hostile feedback", () => {
  const hostile = [
    "try this instead:",
    "```",
    "an untagged fence",
    "```",
    "    a four-space-indented line",
    "````",
    "an even longer fence",
    "````",
  ].join("\n");
  const out = appendRevision(PLAN_V1, hostile, 2);
  expect(hasUntaggedCodeBlock(out)).toBe(false);
  expect(out).toContain("an untagged fence");
  expect(out).toContain("an even longer fence");
});

// ---- demoVersions ----

test("demoVersions returns exactly count plans, oldest first, ending at the final plan", () => {
  const plans = demoVersions(PLAN_V1, 4);
  expect(plans).toHaveLength(4);
  // The newest version — the "current" plan the reviewer lands on — is the final
  // plan verbatim; only the earlier drafts differ (EXC-811).
  expect(plans[3]).toBe(PLAN_V1);
});

test("demoVersions makes every consecutive pair a non-empty, varied diff (not append-only)", () => {
  // Sized off the group count, not the default: each group is applied to the
  // output of the ones before it, so a group whose `to` swallowed a later
  // group's `from` would be a silent no-op that the drift guard — which tests
  // every `from` against the FINAL plan — cannot see.
  const plans = demoVersions(PLAN_V1, PRIMARY.edits.length + 1, PRIMARY.edits);
  // No two adjacent versions are equal — each edit group actually lands.
  for (let i = 1; i < plans.length; i++) {
    expect(plans[i]).not.toBe(plans[i - 1]);
  }
  // An earlier draft is NOT a prefix of a later one: the drafts change text in
  // place rather than only appending.
  expect(plans[3]!.startsWith(plans[0]!.trimEnd())).toBe(false);
});

test("demoVersions makes the default (current vs previous) pair a single targeted change", () => {
  const plans = demoVersions(PLAN_V1, 4);
  const current = plans[3] as string;
  const previous = plans[2] as string;
  // The one authored group-0 edit: 92% (final) ← 88% (previous draft).
  expect(current).toContain("92%");
  expect(current).not.toContain("88%");
  expect(previous).toContain("88%");
  expect(previous).not.toContain("92%");
  // …and it really is a single line-level change between the two versions.
  expect(differingLines(previous, current)).toHaveLength(1);
});

test("demoVersions with count 1 is just the final plan", () => {
  expect(demoVersions(PLAN_V1, 1)).toEqual([PLAN_V1]);
});

test("demoVersions never introduces untagged code blocks", () => {
  for (const plan of demoVersions(PLAN_V1, DEFAULT_NUM_VERSIONS)) {
    expect(hasUntaggedCodeBlock(plan)).toBe(false);
  }
});

// Fixture-drift guard: every reverse edit must still match ITS OWN fixture file,
// or the diff it produces silently flattens to empty. Fails loudly if a fixture
// is edited out from under an edit's `from` span — including by a `rumdl fmt`
// run rewrapping the short plans, which are ordinary repo markdown.
test("every DEV_FIXTURES `from` span still exists in its own fixture file", async () => {
  const stranded: string[] = [];
  for (const fixture of DEV_FIXTURES) {
    const text = await fixtureText(fixture);
    for (const group of fixture.edits) {
      for (const { from } of group) {
        if (!text.includes(from)) stranded.push(`${fixture.file}: ${JSON.stringify(from)}`);
      }
    }
  }
  expect(stranded).toEqual([]);
});

// The switcher needs more than one plan to switch between, and each has to thread
// its own review — two fixtures sharing a session would thread onto one review.
test("DEV_FIXTURES gives every fixture its own file and session", () => {
  expect(DEV_FIXTURES.length).toBeGreaterThan(1);
  expect(PRIMARY.session).toBe(DEV_SESSION);
  expect(new Set(DEV_FIXTURES.map((f) => f.session)).size).toBe(DEV_FIXTURES.length);
  expect(new Set(DEV_FIXTURES.map((f) => f.file)).size).toBe(DEV_FIXTURES.length);
});

// The per-fixture twin of the demoVersions cases above: each fixture's authored
// version count and edits have to produce that many genuinely-different plans the
// hook's format gate accepts, or its compare picker opens on an empty diff.
test("every DEV_FIXTURES entry opens with distinct, format-clean versions", async () => {
  for (const fixture of DEV_FIXTURES) {
    const final = await fixtureText(fixture);
    const plans = demoVersions(final, fixture.versions, fixture.edits);
    expect(plans).toHaveLength(fixture.versions);
    expect(plans.at(-1)).toBe(final);
    for (let i = 1; i < plans.length; i++) {
      expect({ file: fixture.file, same: plans[i] === plans[i - 1] }).toEqual({
        file: fixture.file,
        same: false,
      });
    }
    for (const plan of plans) expect(hasUntaggedCodeBlock(plan)).toBe(false);
  }
});

// The documented graceful path: DEMO_COMMENTS' anchors are fake-plan.md spans, so
// every other fixture gets no fake comments rather than arbitrary ones.
test("only the primary fixture carries DEMO_COMMENTS anchors", async () => {
  for (const fixture of DEV_FIXTURES.slice(1)) {
    expect(demoAnnotations(await fixtureText(fixture), 1)).toEqual([]);
  }
});

// Fence-parity guard: the plan view toggles in and out of code on every fence
// line (codeBlockRanges), so an odd number of them anywhere in the fixture puts
// every line from the last fence to EOF inside a code panel — the closing
// section, and every revision the driver threads onto it. Nothing else runs the
// fixture through that detection, and the damage is invisible to the format gate.
test("no fixture code block runs to the end of the file (fence lines pair up)", () => {
  const last = codeBlockRanges(PLAN_V1).at(-1);
  expect(last).toBeDefined();
  expect(last!.end).toBeLessThan(PLAN_V1.split("\n").length);
});

// ---- demoAnnotations ----

test("demoAnnotations anchors inside the plan and never on a blank line", () => {
  const lines = PLAN_V1.split("\n");
  const anns = demoAnnotations(PLAN_V1, 2);
  expect(anns).toHaveLength(3);
  for (const a of anns) {
    expect(a.startLine).toBeGreaterThanOrEqual(1);
    expect(a.endLine).toBeGreaterThanOrEqual(a.startLine);
    expect(a.endLine).toBeLessThanOrEqual(lines.length);
    expect(lines[a.startLine - 1]?.trim()).not.toBe("");
  }
  // Spread through the document rather than bunched at the top.
  expect(new Set(anns.map((a) => a.startLine)).size).toBe(3);
});

test("demoAnnotations anchors each comment on the line its text is about", () => {
  // The point of the fixture: a reviewer reading "give this coverage number a
  // denominator" must find it on the coverage row, not on whatever prose happens
  // to sit a fixed fraction of the way down the file.
  const lines = PLAN_V1.split("\n");
  const anns = demoAnnotations(PLAN_V1, 2);
  expect(anns).toHaveLength(DEMO_COMMENTS.length);
  anns.forEach((a, i) => {
    expect(lines[a.startLine - 1]).toContain(DEMO_COMMENTS[i]?.anchor as string);
    expect(a.comment).toContain(DEMO_COMMENTS[i]?.body as string);
    expect(a.endLine).toBe(a.startLine);
  });
});

// Fixture-drift guard, the anchor twin of the DEMO_EDIT_GROUPS one: an anchor
// that no longer matches drops its comment silently, and one that matches twice
// pins it to whichever copy comes first. Both fail loudly here instead.
test("every DEMO_COMMENTS anchor still matches the fixture exactly once", () => {
  for (const { anchor } of DEMO_COMMENTS) {
    expect(PLAN_V1.split(anchor)).toHaveLength(2);
  }
});

test("demoAnnotations yields deterministic ids and version-naming bodies", () => {
  const anns = demoAnnotations(PLAN_V1, 2);
  expect(anns.map((a) => a.id)).toEqual(["dev-v2-c1", "dev-v2-c2", "dev-v2-c3"]);
  // Every body names its version (the panel's version badge) and differs from
  // its siblings (the panel's search filter).
  for (const a of anns) expect(a.comment).toStartWith("v2: ");
  expect(new Set(anns.map((a) => a.comment)).size).toBe(3);
  // Same input, same output — a spec or a manual check can name one by id.
  expect(demoAnnotations(PLAN_V1, 2)).toEqual(anns);
  expect(demoAnnotations(PLAN_V1, 3).map((a) => a.id)).toEqual([
    "dev-v3-c1",
    "dev-v3-c2",
    "dev-v3-c3",
  ]);
});

test("demoAnnotations drops the anchors a plan does not carry, keeping ids dense", () => {
  // Only the second anchor is present, so one comment lands — numbered c1, not
  // c2: a dropped anchor leaves no gap for a spec or a manual check to trip over.
  const partial = `# Tiny\n\n${DEMO_COMMENTS[1]?.anchor} shipped | 92% |\n`;
  const anns = demoAnnotations(partial, 1);
  expect(anns.map((a) => a.id)).toEqual(["dev-v1-c1"]);
  expect(anns[0]?.comment).toContain(DEMO_COMMENTS[1]?.body as string);
  // A plan carrying none of them — any plan that isn't the fixture — gets none.
  expect(demoAnnotations("# Tiny\n\nOne line.\n", 1)).toEqual([]);
  expect(demoAnnotations("\n\n", 1)).toEqual([]);
});

// ---- citation guard: fake-plan.md → doc/DEVELOPMENT.md (EXC-1045) ----

// The fixture cites doc/DEVELOPMENT.md by line, and the bullets around those
// citations assert what the preview does with them. Read the page the way the
// excerpt reader counts it — splitLines in src/plan/excerpt.ts drops the phantom
// element a trailing newline leaves — so a line number here means the editor's line.
const DEV_GUIDE = "doc/DEVELOPMENT.md";
const DEV_GUIDE_LINES = (await Bun.file(`${import.meta.dir}/../../${DEV_GUIDE}`).text())
  .replace(/\n$/, "")
  .split("\n");

// Parsed out of the fixture rather than copied here: a second copy is a second thing
// to keep in sync, which is the bug class this guards. The suffix grammar mirrors
// LINE_SUFFIX in ui/src/lib/diffview/fileRefs.ts — the one definition of a line
// citation — so a spelling the renderer accepts cannot quietly fall out of this scan,
// and one it refuses cannot sneak in. A bare `#` before the digits is refused there
// and here: `doc/DEVELOPMENT.md#3-setup` links to a numbered anchor rather than citing
// line 3. Scoped to this one page on purpose — `mise.toml:900` is cited past the end
// deliberately, to demonstrate the clamp.
const DEV_GUIDE_CITATIONS = [
  ...PLAN_V1.matchAll(/doc\/DEVELOPMENT\.md(?::L?|:?#L)(\d+)(?:[-–,]L?(\d+)|:\d+)?/g),
].map((m) => ({ text: m[0], start: Number(m[1]), end: Number(m[2] ?? m[1]) }));

test("every doc/DEVELOPMENT.md citation in the fixture lands on a real, non-blank line", () => {
  // A fixture that stopped citing the page would otherwise satisfy the loop below
  // vacuously — the guard has to have something to guard.
  expect(DEV_GUIDE_CITATIONS.length).toBeGreaterThan(0);
  // The anchor is the line the preview marks and parks on; a blank anchor is the
  // break this guards (EXC-1037). Blank lines *inside* a cited span are ordinary
  // prose spacing and are not a break.
  const broken = DEV_GUIDE_CITATIONS.flatMap((c) => {
    if (c.end > DEV_GUIDE_LINES.length) {
      return [`${c.text} cites past the end of ${DEV_GUIDE} (${DEV_GUIDE_LINES.length} lines)`];
    }
    if (DEV_GUIDE_LINES[c.start - 1]?.trim() === "") {
      return [`${c.text} anchors on line ${c.start} of ${DEV_GUIDE}, which is blank`];
    }
    return [];
  });
  expect(broken).toEqual([]);
});

test("doc/DEVELOPMENT.md is long enough for the fixture's citation windows", () => {
  // Every citation is fetched with EXCERPT_RADIUS lines of context past its end —
  // padded by the panel for a range (ui/src/components/FilePreview.svelte), by the
  // daemon for a bare line (readFileExcerpt in src/plan/excerpt.ts) — bounded by
  // MAX_CITED_SPAN_LINES. Under that floor the window clamps short, which is what
  // would make the `:154-162` bullet's "reaches 30 lines past the span" false.
  // Derived from the citations, so moving one moves the floor with it.
  const short = DEV_GUIDE_CITATIONS.map((c) => ({
    text: c.text,
    floor: Math.min(c.end, c.start + MAX_CITED_SPAN_LINES) + EXCERPT_RADIUS,
  }))
    .filter((c) => DEV_GUIDE_LINES.length < c.floor)
    .map(
      (c) =>
        `${DEV_GUIDE} is ${DEV_GUIDE_LINES.length} lines; ${c.text} needs at least ${c.floor}, or its preview window clamps short of the ${EXCERPT_RADIUS} lines of context it asks for`,
    );
  expect(short).toEqual([]);
});

// ---- parsePositiveInt (shared by the driver flag and the CLI option) ----

test("parsePositiveInt accepts positive integers and names the flag on error", () => {
  expect(parsePositiveInt("5", "--num-versions")).toBe(5);
  expect(parsePositiveInt("1", "--x")).toBe(1);
  for (const bad of ["0", "-2", "abc", "2.5", "", undefined]) {
    expect(() => parsePositiveInt(bad, "--x")).toThrow("--x expects a positive integer");
  }
});

// ---- parseNumVersions (--num-versions dev flag) ----

test("parseNumVersions defaults to four versions when the flag is absent", () => {
  expect(DEFAULT_NUM_VERSIONS).toBe(4);
  expect(parseNumVersions(["bun", "driver.ts"])).toBe(DEFAULT_NUM_VERSIONS);
});

test("parseNumVersions reads the integer after --num-versions", () => {
  expect(parseNumVersions(["bun", "driver.ts", "--num-versions", "5"])).toBe(5);
  // Order-independent and coexists with other flags.
  expect(parseNumVersions(["bun", "driver.ts", "--notify", "--num-versions", "1"])).toBe(1);
});

test("parseNumVersions rejects non-positive-integer values loudly", () => {
  for (const bad of ["0", "-2", "abc", "2.5", ""]) {
    expect(() => parseNumVersions(["bun", "driver.ts", "--num-versions", bad])).toThrow();
  }
  // Flag present but no value → throw rather than silently default.
  expect(() => parseNumVersions(["bun", "driver.ts", "--num-versions"])).toThrow();
});

// ---- nextPlan ----

test("nextPlan on a reviewer deny appends a revision and bumps the counter", () => {
  const next = nextPlan(
    { plan: PLAN_V1, revision: 0 },
    { behavior: "deny", feedback: "tighten scope", decidedAt: 1 },
    PLAN_V1,
  );
  expect(next.action).toBe("revise");
  expect(next.revision).toBe(1);
  expect(next.plan).toContain("## Revision 1");
  expect(next.plan).toContain("tighten scope");
});

test("nextPlan treats a non-fail-safe reviewer deny as a real revision", () => {
  // Any deny whose feedback isn't a "caret: " fail-safe is reviewer feedback,
  // not a fail-safe — even the empty-feedback case the daemon may surface.
  const next = nextPlan(
    { plan: PLAN_V1, revision: 2 },
    { behavior: "deny", feedback: "Plan changes requested.", decidedAt: 1 },
    PLAN_V1,
  );
  expect(next.action).toBe("revise");
  expect(next.revision).toBe(3);
  expect(next.plan).toContain("## Revision 3");
});

test("nextPlan resubmits unchanged on the hook's own fail-safe deny shapes", () => {
  const next = nextPlan(
    { plan: PLAN_V1, revision: 1 },
    {
      behavior: "deny",
      feedback: "caret: review timed out — denying so no unreviewed plan ships. See /x.",
      decidedAt: 1,
    },
    PLAN_V1,
  );
  expect(next.action).toBe("resubmit");
  expect(next.plan).toBe(PLAN_V1);
  expect(next.revision).toBe(1);
});

test("nextPlan on approve re-seeds a fresh v1 and resets the counter", () => {
  const revised = appendRevision(PLAN_V1, "feedback", 1);
  const next = nextPlan(
    { plan: revised, revision: 1 },
    { behavior: "allow", decidedAt: 1 },
    PLAN_V1,
  );
  expect(next.action).toBe("reseed");
  expect(next.plan).toBe(PLAN_V1);
  expect(next.revision).toBe(0);
});

test("nextPlan on a Reject deny waits — no revision, no resubmit (EXC-685)", () => {
  // The reviewer rejected the plan (deny carrying the canned reject-and-wait
  // message). The dev agent must NOT thread a revision and re-present — it
  // simulates waiting for the user's next message. Distinct from request-changes.
  const revised = appendRevision(PLAN_V1, "earlier feedback", 1);
  const next = nextPlan(
    { plan: revised, revision: 1 },
    { behavior: "deny", feedback: PLAN_REJECTED_MESSAGE, decidedAt: 1 },
    PLAN_V1,
  );
  expect(next.action).toBe("wait");
  expect(next.plan).toBe(revised);
  expect(next.plan).not.toContain("## Revision 2");
});

// ---- the real hook path, end to end ----

test("a revision round-trips through the real runReview hook path and logs to caret.log", async () => {
  await boot();
  const deps = devReviewDeps(base, () => {});
  // First submission: the driver's initial seed, through the real hook.
  const first = runReview(hookStdin(PLAN_V1), deps);
  const id = await waitFor(async () => {
    const list = (await (await fetch(`${base}/api/reviews`)).json()) as Array<{ id: string }>;
    return list[0]?.id;
  });
  await resolve(id, "deny", "needs a rollout plan");
  const out = await first;
  expect(out.behavior).toBe("deny");
  expect(out.feedback).toBe("needs a rollout plan");
  // The driver's step: append Revision 1 and resubmit through the same path.
  const next = nextPlan({ plan: PLAN_V1, revision: 0 }, out, PLAN_V1);
  const second = runReview(hookStdin(next.plan), deps);
  const threaded = await waitFor(async () => {
    const r = await clientReview(id);
    return r.version === 2 ? r : undefined;
  });
  expect(threaded.sessionId).toBe(DEV_SESSION);
  expect(threaded.status).toBe("pending");
  expect(threaded.currentPlan).toContain("## Revision 1");
  expect(threaded.currentPlan).toContain("needs a rollout plan");
  await resolve(id, "allow");
  const out2 = await second;
  expect(out2.behavior).toBe("allow");
  // Real hook records landed in the dev state dir's caret.log.
  const log = await Bun.file(join(dir, "caret", "logs", "caret.log")).text();
  expect(log).toContain('"step":"decision"');
  // EXC-444: reviewer feedback bodies are never logged — the rejected-plan
  // record carries only the feedback's length.
  expectNeverLogsBody(log, "needs a rollout plan");
  expect(log).toContain('"feedbackChars":20');
  expect(log).toContain(DEV_SESSION);
});

test("bootstrapReview grows the primary review to several varied versions before the loop", async () => {
  await boot();
  const deps = devReviewDeps(base, () => {});
  const state = await bootstrapReview(base, { ...PRIMARY, plan: PLAN_V1 }, deps);
  const review = d.store.bySession(DEV_SESSION)[0];
  expect(review).toBeDefined();
  // Default is four versions — the final plan plus three earlier drafts, one per
  // kind of diff, enough for every flavor to show in the version-compare picker.
  expect(review!.versions).toHaveLength(4);
  // Diff variety, not append-only: the newest version carries the final's
  // targeted value (92%) while the previous draft still carries the earlier one
  // (88%), so comparing them shows a real in-place change, not appended text.
  const plans = review!.versions.map((v) => v.plan);
  expect(plans.at(-1)).toContain("92%");
  expect(plans.at(-1)).not.toContain("88%");
  expect(plans.at(-2)).toContain("88%");
  // Every version carries its own fake comments, drafted before the deny that
  // ends it — annotations are version-scoped, so this is what gives the compare
  // view something to show on both sides of a pair.
  for (const v of review!.versions) {
    expect(v.annotations).toHaveLength(3);
    expect(v.annotations[0]?.comment).toStartWith(`v${v.version}: `);
    // Anchored against the STORED plan, which the ingest reflow rewrote — an
    // anchor computed from the submitted text would land off the end or on a
    // blank line here.
    const lines = v.plan.split("\n");
    for (const a of v.annotations) {
      const line = a as { startLine: number; endLine: number };
      expect(line.endLine).toBeLessThanOrEqual(lines.length);
      expect(lines[line.startLine - 1]?.trim()).not.toBe("");
    }
    // …and on the line each comment is about. This is the end-to-end guard the
    // unit anchor test can't be: the reflow rewraps prose and the demo edits
    // change word lengths, so only the real submit → reflow → store path proves
    // every anchor still resolves, in every version, to the line the reviewer sees.
    v.annotations.forEach((a, i) => {
      const line = (a as { startLine: number }).startLine;
      expect(lines[line - 1]).toContain(DEMO_COMMENTS[i]?.anchor as string);
    });
  }
  // The review is left rejected; the interactive loop re-pends it by appending
  // its own next revision from the returned state. The returned plan carries that
  // next revision so the loop's first post is a fresh version, not a duplicate.
  expect(review!.status).toBe("rejected");
  expect(state.revision).toBe(4);
  expect(state.plan).toContain("## Revision 4");
});

test("bootstrapReview honors an explicit --num-versions count", async () => {
  await boot();
  const deps = devReviewDeps(base, () => {});
  const state = await bootstrapReview(base, { ...PRIMARY, plan: PLAN_V1, versions: 5 }, deps);
  const review = d.store.bySession(DEV_SESSION)[0];
  expect(review!.versions).toHaveLength(5);
  expect(state.revision).toBe(5);
  expect(state.plan).toContain("## Revision 5");
});

test("bootstrapReview with a single version seeds just v1", async () => {
  await boot();
  const deps = devReviewDeps(base, () => {});
  const state = await bootstrapReview(base, { ...PRIMARY, plan: PLAN_V1, versions: 1 }, deps);
  const review = d.store.bySession(DEV_SESSION)[0];
  expect(review!.versions).toHaveLength(1);
  expect(state.revision).toBe(1);
});

test("each fixture bootstraps onto its own review, in table order", async () => {
  await boot();
  const deps = devReviewDeps(base, () => {});
  for (const fixture of DEV_FIXTURES) {
    await bootstrapReview(base, { ...fixture, plan: await fixtureText(fixture) }, deps);
  }
  // One review per fixture, opened at that fixture's authored version count —
  // the switcher has genuinely separate plans to switch between.
  const created = DEV_FIXTURES.map((fixture) => {
    const reviews = d.store.bySession(fixture.session);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.versions).toHaveLength(fixture.versions);
    return reviews[0]!.createdAt;
  });
  // store.list() sorts pending reviews by createdAt ascending, so bootstrapping
  // in table order is what puts the primary first in the switcher.
  expect([...created].sort((a, b) => a - b)).toEqual(created);
});

test("runExtraReview runs one fresh-session review to resolution and stops", async () => {
  await boot();
  const deps = devReviewDeps(base, () => {});
  const session = "caret-dev-extra-test";
  const done = runExtraReview(session, extraPlan(PLAN_V1, 1), deps);
  // The extra review lands under its OWN session — a genuinely-new review id,
  // which is exactly what the notification path needs (EXC-427).
  const seeded = await waitFor(async () => {
    const list = (await (await fetch(`${base}/api/reviews`)).json()) as Array<{
      id: string;
      sessionId: string;
      title: string;
    }>;
    return list.find((r) => r.sessionId === session);
  });
  expect(seeded.title).toContain("— extra 1");
  // A reviewer deny threads a revision into the same extra review...
  await resolve(seeded.id, "deny", "extra feedback");
  const threaded = await waitFor(async () => {
    const r = await clientReview(seeded.id);
    return r.version === 2 ? r : undefined;
  });
  expect(threaded.currentPlan).toContain("## Revision 1");
  // ...and approve ends the thread: the loop completes instead of re-seeding.
  await resolve(seeded.id, "allow");
  await done;
  const remaining = (await (await fetch(`${base}/api/reviews`)).json()) as Array<unknown>;
  expect(remaining).toHaveLength(0);
});

// ---- runExtraSeeder ----

// Drive the seeder loop deterministically: each tick() releases one injected
// sleep and flushes microtasks; injected seeds resolve only when a test says
// so (an unresolved seed is a pending extra review).
function makeSeederHarness(maxPending?: number) {
  let release: (() => void) | undefined;
  const sleep = () =>
    new Promise<void>((r) => {
      release = r;
    });
  const seeds: { n: number; resolve: () => void }[] = [];
  const seed = (n: number) =>
    new Promise<void>((r) => {
      seeds.push({ n, resolve: r });
    });
  void runExtraSeeder(1, { seed, sleep, maxPending, log: () => {} });
  const tick = async () => {
    release?.();
    await Bun.sleep(0); // let the loop run to its next sleep
  };
  return { seeds, tick };
}

test("runExtraSeeder seeds one numbered extra review per tick", async () => {
  const h = makeSeederHarness();
  await h.tick();
  await h.tick();
  expect(h.seeds.map((s) => s.n)).toEqual([1, 2]);
});

test("runExtraSeeder skips ticks at the pending cap and resumes on resolve", async () => {
  // Cap 2: two unresolved extras block further seeds — a wall of unapproved
  // extras must not pile up — but a resolve frees the next tick to seed again
  // (the hidden-tab demo keeps working even if an earlier extra sits pending).
  const h = makeSeederHarness(2);
  await h.tick();
  await h.tick();
  await h.tick(); // at the cap: skipped
  expect(h.seeds.map((s) => s.n)).toEqual([1, 2]);
  h.seeds[0]?.resolve();
  await Bun.sleep(0); // let the seeder's pending-- settle, as real seconds-apart ticks would
  await h.tick();
  expect(h.seeds.map((s) => s.n)).toEqual([1, 2, 3]);
});

// ---- isolation guard ----

test("assertDevEnv requires an explicit dev port + state dir (isolation guard)", () => {
  const savedPort = process.env.CARET_PORT;
  const savedState = process.env.XDG_STATE_HOME;
  try {
    // Missing port → reject.
    delete process.env.CARET_PORT;
    process.env.XDG_STATE_HOME = "/tmp/caret-dev-test";
    expect(() => assertDevEnv()).toThrow();
    // Production default port → reject (never touch the installed caret).
    process.env.CARET_PORT = "42718";
    expect(() => assertDevEnv()).toThrow();
    // Non-numeric / non-positive port → reject (the daemon would silently fall
    // back to the production default).
    process.env.CARET_PORT = "abc";
    expect(() => assertDevEnv()).toThrow();
    process.env.CARET_PORT = "0";
    expect(() => assertDevEnv()).toThrow();
    // Dev port but no isolated state dir → reject.
    process.env.CARET_PORT = "42719";
    delete process.env.XDG_STATE_HOME;
    expect(() => assertDevEnv()).toThrow();
    // Both explicit and non-default → ok.
    process.env.CARET_PORT = "42719";
    process.env.XDG_STATE_HOME = "/tmp/caret-dev-test";
    expect(() => assertDevEnv()).not.toThrow();
  } finally {
    if (savedPort === undefined) delete process.env.CARET_PORT;
    else process.env.CARET_PORT = savedPort;
    if (savedState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = savedState;
  }
});
