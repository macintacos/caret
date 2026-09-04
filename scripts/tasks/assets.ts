// `assets` task (EXC-805): regenerate the README's hero artifacts — a four-theme
// diagonal stitch of the plan view, and a screen recording of the review arc
// (read a plan, annotate it, send it back, approve, watch the agent pick up).
// Both come out of this one command, so refreshing them after the UI moves is a
// task run rather than a hand-composed screenshot.
//
// It lives under scripts/tasks/ rather than test/e2e/ deliberately: a generator
// is not a spec, and a file under test/e2e/ matching `**/*.e2e.ts` would be swept
// into `mise run preflight`. For the same reason it drives the browser through
// the Playwright LIBRARY (chromium.launch) instead of the test runner, which
// would need a second config to collect it.
//
// Nothing else here is a new subsystem. The isolated daemon boot is
// scripts/tasks/dev/run.ts's (childEnvFor, daemonCommand, makeCleanup,
// discoverPort); the agent's side of the recording is the dev driver's real hook
// path (devReviewDeps + runReview + nextPlan), so Request changes really appends a
// revision and Approve really unblocks; the gestures are the ones test/e2e's
// keyboard-commenting / diff-surface / request-changes / approve specs already
// drive. The pure halves — the tool lookup, the seam geometry, the argv — are
// unit-tested in test/scripts/assets.test.ts.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";

import { isPidAlive } from "@/daemon/lifecycle.ts";
import type { ClientReview, RouteResult } from "@/lib/types.ts";
import { runReview } from "@/review/orchestrate.ts";
import { ensureUi, runTargetsAfterUi } from "@/tasks/build.ts";
import { discoverPort, readDevLockPort } from "@/tasks/dev/dev-env.ts";
import { devReviewDeps } from "@/tasks/dev/driver.ts";
import { type DriverState, hookStdin, nextPlan } from "@/tasks/dev/protocol.ts";
import { childEnvFor, daemonCommand, makeCleanup } from "@/tasks/dev/run.ts";
import { runForward } from "@/tasks/lib/exec.ts";
import { installCleanupHandlers } from "@/tasks/lib/signals.ts";
import { chromiumInstalled } from "@/tasks/test.ts";

// --- shared shape ------------------------------------------------------------

/** The stitch's frame in CSS pixels, pinned: identical dimensions are what let
 * the four captures' seams line up. */
export const FRAME = { width: 1440, height: 900 } as const;

/** Device pixels per CSS pixel for the stitch, so the committed hero is crisp on
 * a high-DPI display rather than upscaled by the browser showing it. The
 * composite therefore runs at FRAME × this, which is why the geometry helpers
 * take explicit dimensions instead of reading FRAME. */
const STITCH_SCALE = 2;

const STITCH_PATH = "doc/assets/caret-review-ui.png";

/** The recording. Gitignored, unlike the stitch: it is uploaded to GitHub and
 * linked from the README by its attachment URL, which is the form a reader can
 * actually watch — a repo path only offers a download, and a file this size is
 * past what GitHub's own file viewer will preview. H.264 in an mp4 rather than
 * Playwright's native webm, so it opens in any player without a plugin.
 * doc/DEVELOPMENT.md carries the upload step. */
const VIDEO_PATH = "doc/assets/caret-review-demo.mp4";

/**
 * The recording's viewport, in CSS pixels, and its device-pixel multiplier.
 *
 * Narrower than the stitch's frame on purpose. The UI lays out in CSS pixels, so
 * fewer of them across the window makes every glyph a larger fraction of the
 * frame — the axis no amount of resolution substitutes for. The multiplier is the
 * other axis: how many real pixels each of those glyphs is drawn with.
 */
const VIDEO_VIEWPORT = { width: 1280, height: 800 } as const;

/**
 * Two, not three, and the constraint is frame rate rather than storage.
 *
 * A screenshot's cost tracks its pixel count, and it contends with the gestures
 * for the same CDP session — at 3× the loop settles around 6fps, which is too
 * choppy to watch a pointer move through. 2× lands near 15fps and still renders
 * every glyph with four device pixels per CSS pixel, which is past the point
 * where more resolution is visible on any display that will play this.
 */
const VIDEO_SCALE = 2;

/** The cwd the reviewed plan claims to come from. Two segments, so `shortCwd`
 * (ui/src/lib/cwd.ts) renders it whole rather than eliding to `…/parent/leaf` —
 * and no contributor path, hostname, or project name can reach a committed asset. */
const DEMO_CWD = "~/acme-web";

/** The line of the demo plan the still's inline comment anchors to, and the plan
 * title the recording waits on before it touches anything. Both are matched
 * against the STORED plan (the daemon reflows every plan at ingest), and a miss
 * is fatal so a fixture edit can't silently drop the comment card from the hero.
 * Exported because `test/scripts/assets.test.ts` pins them against
 * `scripts/tasks/dev/demo-plan.md` — that file is listed in preflight's
 * MARKDOWN_READ_BY_TESTS, so editing it alone still runs the guard. */
export const ANNOTATION_ANCHOR = '3. Keep the closing "published vX.Y.Z" line unconditional.';
export const PLAN_TITLE_FRAGMENT = "Add a `--quiet` flag";

const ANNOTATION_BODY = "say what `--quiet` does to this line when the publish step fails.";

/**
 * The four palettes, top-left band first: caret's own dark and light lead, then
 * one community palette of each scheme.
 *
 * The order alternates dark and light on purpose, and that is what makes the
 * stitch legible rather than a preference. Four palettes of one scheme are all
 * within a few RGB points of each other at a glance, so adjacent bands read as
 * one region and the seams between them disappear — the picture then says
 * "two themes, unevenly cut" no matter how evenly the geometry spaces them.
 * Alternating puts maximum contrast across every seam.
 *
 * Each entry carries the scheme whose slot key holds it (ui/src/lib/appearance.ts),
 * which is what pins the resolved theme without clicking through Settings.
 */
const BANDS = [
  { theme: "caret-dark", scheme: "dark" },
  { theme: "caret-light", scheme: "light" },
  { theme: "dracula", scheme: "dark" },
  { theme: "catppuccin-latte", scheme: "light" },
] as const;

// --- pure helpers ------------------------------------------------------------

/** Resolve a host tool, naming the install when it is absent. Without this the
 * failure surfaces as an ENOENT from a spawn deep inside the pipeline, which says
 * nothing about what to install. Neither tool is pinned in `mise.toml`: both have
 * no `aqua:` entry, and the registry alternatives would put a multi-minute build
 * in front of every fresh clone. */
export function resolveTool(
  which: (cmd: string) => string | null,
  tool: string,
  formula: string,
): string {
  const bin = which(tool);
  if (!bin) {
    throw new Error(
      `caret assets: ${tool} is not on PATH. Install it with \`brew install ${formula}\` ` +
        "(it is a host tool, deliberately not pinned in mise.toml).",
    );
  }
  return bin;
}

/**
 * How steep the seams run, in degrees above horizontal.
 *
 * Load-bearing, not decoration. A seam shallower than
 * `atan(height / (2 · width / bands))` — about 51° on a 1440×900 frame cut four
 * ways — leaves through the frame's left or right edge instead of its bottom,
 * which turns the outer bands into corner triangles while the inner ones stay
 * parallelograms. Evenly spaced seams then produce visibly *un*even bands, and
 * the picture reads as two themes badly cut rather than four evenly sampled.
 * 60° clears that floor with room to spare and still reads as a diagonal.
 */
const SEAM_ANGLE_DEG = 60;

/** How far a seam travels horizontally over the frame's full height. */
const seamRun = (height: number): number => height / Math.tan((SEAM_ANGLE_DEG * Math.PI) / 180);

/**
 * Where seam k enters the top edge and leaves the bottom edge.
 *
 * Positioned so that its MEAN x across the height is exactly `k · width / bands`.
 * For a straight line the mean is the mid-height value, and the area to a
 * full-height seam's left is that mean times the height — so evenly spaced
 * mid-heights is precisely the condition that every band has area
 * `width · height / bands`. That equivalence only holds while the seam stays
 * inside the frame, which is what SEAM_ANGLE_DEG guarantees.
 */
function seamEdges(
  width: number,
  height: number,
  bands: number,
  k: number,
): { top: number; bottom: number } {
  const run = seamRun(height);
  const bottom = (width * k) / bands - run / 2;
  return { top: bottom + run, bottom };
}

const point = (x: number, y: number): string => `${Math.round(x)},${Math.round(y)}`;

const seamIndices = (bands: number): number[] => Array.from({ length: bands - 1 }, (_, i) => i + 1);

/** The seams themselves, as magick `x1,y1 x2,y2` draw points — one per cut,
 * each spanning the frame from its top edge to its bottom edge. */
export function seamLines(width: number, height: number, bands: number): string[] {
  return seamIndices(bands).map((k) => {
    const { top, bottom } = seamEdges(width, height, bands, k);
    return `${point(top, 0)} ${point(bottom, height)}`;
  });
}

/**
 * The half-plane mask polygon for each band past the first, cut along its seam.
 *
 * Derived from the band count rather than written out as fixed polygons: the
 * geometry is the same half-plane every time, so taking the form that is less code
 * is also the form that generalizes. Each polygon is the seam — extended a frame
 * past both horizontal edges so the mask reaches the corners — swept far in `+x`,
 * which is the side the later band paints on. That keeps it a simple convex
 * quadrilateral, where clipping the half-plane to the frame's own corners would
 * fold into a self-intersecting bowtie.
 */
export function seamPolygons(width: number, height: number, bands: number): string[] {
  const sweep = 4 * width;
  const run = seamRun(height);
  return seamIndices(bands).map((k) => {
    const { top, bottom } = seamEdges(width, height, bands, k);
    // One frame-height beyond each edge, along the seam's own slope.
    const above = { x: top + run, y: -height };
    const below = { x: bottom - run, y: 2 * height };
    return [
      point(above.x, above.y),
      point(below.x, below.y),
      point(below.x + sweep, below.y),
      point(above.x + sweep, above.y),
    ].join(" ");
  });
}

/** Mask one capture down to its band, in a single magick call: the mask is built
 * inline as a parenthesized subimage and copied into the capture's alpha, so no
 * intermediate mask file is written. */
export function bandCommand(
  magick: string,
  width: number,
  height: number,
  capture: string,
  polygon: string,
  out: string,
): string[] {
  return [
    magick,
    capture,
    "(",
    "-size",
    `${width}x${height}`,
    "xc:black",
    "-fill",
    "white",
    "-draw",
    `polygon ${polygon}`,
    ")",
    "-alpha",
    "off",
    "-compose",
    "CopyOpacity",
    "-composite",
    out,
  ];
}

/** Flatten the bands in order, then stroke the seams over the joins in the live
 * accent — the divider is caret's own accent rather than a neutral hairline. The
 * stroke is given in device pixels, so it scales with the capture rather than
 * thinning out as the frame grows. */
export function stitchCommand(
  magick: string,
  layers: string[],
  accent: string,
  lines: string[],
  strokeWidth: number,
  out: string,
): string[] {
  return [
    magick,
    ...layers,
    "-flatten",
    "-stroke",
    accent,
    "-strokewidth",
    String(strokeWidth),
    ...lines.flatMap((line) => ["-draw", `line ${line}`]),
    out,
  ];
}

/** Encode the captured frames into an H.264 mp4. `fps` is measured from the run
 * rather than assumed, so the result plays back at real time however the capture
 * loop actually paced. `yuv420p` plus `+faststart` is what makes it playable in a
 * browser and in QuickTime rather than only in a developer's media player. */
export function encodeCommand(
  ffmpeg: string,
  fps: number,
  framePattern: string,
  out: string,
): string[] {
  return [
    ffmpeg,
    "-y",
    "-loglevel",
    "error",
    "-framerate",
    fps.toFixed(3),
    "-i",
    framePattern,
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    out,
  ];
}

// --- the isolated daemon -----------------------------------------------------

/** Boot a caret daemon on an OS-assigned port with its own ephemeral state dir,
 * run `body` against it, and reap both. The same boot `mise run dev` performs,
 * minus Vite and the supervision loop: the daemon serves the built ui/dist, which
 * is what makes the captures show the shipped UI rather than a dev server's. */
async function withDaemon<T>(body: (base: string, stateDir: string) => Promise<T>): Promise<T> {
  const stateDir = mkdtempSync(join(tmpdir(), "caret-assets."));
  const worldDir = join(stateDir, "caret");
  const portMode = { kind: "ephemeral" } as const;
  const env = childEnvFor(stateDir, portMode);
  // Hand the daemon the mise-pinned rumdl. The state dir is ephemeral, so without
  // this every run re-downloads the pinned 5.6MB release to format one plan — the
  // reason pinnedRumdl() exists in test/e2e/support/fixtures.ts.
  const rumdl = Bun.which("rumdl");
  if (rumdl) env.CARET_RUMDL_BIN = rumdl;

  const children: { kill(): void }[] = [];
  const cleanup = makeCleanup(children, {
    stateDirPath: stateDir,
    wipeOnExit: true,
    rm: (dir) => rmSync(dir, { recursive: true, force: true }),
  });
  installCleanupHandlers(cleanup);

  // Its NDJSON log would drown the task's own output, and a daemon that dies on
  // boot is already reported loudly by discoverPort (DAEMON_DIED).
  const daemon = Bun.spawn(daemonCommand(portMode), {
    stdout: "ignore",
    stderr: "ignore",
    env,
  });
  children.push(daemon);
  try {
    const port = await discoverPort({
      readPort: () => readDevLockPort(join(worldDir, "daemon.lock"), worldDir),
      daemonAlive: () => isPidAlive(daemon.pid),
    });
    return await body(`http://127.0.0.1:${port}`, stateDir);
  } finally {
    cleanup();
  }
}

const demoPlan = (): Promise<string> => Bun.file(`${import.meta.dir}/dev/demo-plan.md`).text();

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`caret assets: ${what} → ${res.status}`);
  return (await res.json()) as T;
}

/** Post a plan through the public route the hook uses, harness-side. */
async function postPlan(base: string, plan: string, sessionId: string): Promise<string> {
  const res = await fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, cwd: DEMO_CWD, plan }),
  });
  return (await json<RouteResult>(res, "POST /api/reviews")).id;
}

const getReview = async (base: string, id: string): Promise<ClientReview> =>
  json<ClientReview>(await fetch(`${base}/api/reviews/${id}`), `GET /api/reviews/${id}`);

// --- the browser -------------------------------------------------------------

/** Pin the appearance before the app boots, and mark onboarding seen so the
 * first-run modal never covers the shot. Written straight to the keys
 * ui/src/lib/appearance.ts owns, so the resolved palette is fixed rather than
 * clicked through Settings. */
async function pinAppearance(context: BrowserContext, band: (typeof BANDS)[number]): Promise<void> {
  await context.addInitScript(
    ({ mode, slotKey, theme }: { mode: string; slotKey: string; theme: string }) => {
      localStorage.setItem("caret.theme.mode", mode);
      localStorage.setItem(slotKey, theme);
      localStorage.setItem("caret.onboarded", "1");
    },
    {
      mode: band.scheme,
      slotKey: band.scheme === "dark" ? "caret.theme.dark" : "caret.theme.light",
      theme: band.theme,
    },
  );
}

/** Wait until the seeded plan has rendered — `.diff-plan` is the plan's scroll
 * container (test/e2e/support/source-view.ts names the same handle). */
async function planSurface(page: Page): Promise<Locator> {
  const plan = page.locator(".diff-plan");
  await plan.waitFor({ state: "visible" });
  return plan;
}

/** The status strip's tally, once it reads exactly one comment — the proof a
 * comment reached the review. Waiting on the tally rather than on the comment's
 * own text is what makes it hold in both card states: a committed card renders
 * its body as markdown, so a body carrying a code span is not one text node to
 * match against.
 *
 * Deliberately re-derived rather than imported from `test/e2e/support/chrome.ts`,
 * which names the same control: that file is the Playwright suite's harness, and
 * a task module reaching into `test/` inverts the dependency the whole tree
 * assumes. The regex is anchored for the reason chrome.ts's is — `getByRole`'s
 * string form matches the accessible name as a substring, so "1 comment" would
 * also collect "11 comments". */
const oneComment = (page: Page): Locator => page.getByRole("button", { name: /^1 comment$/ });

// --- assets stitch -----------------------------------------------------------

/** Seed the still's review: one plan, one inline comment on a line worth
 * commenting on. Anchored against the STORED plan — the daemon reflows every plan
 * at ingest, so a line counted off the fixture does not index what is served. */
async function seedStill(base: string): Promise<void> {
  const id = await postPlan(base, await demoPlan(), "caret-assets-still");
  const stored = (await getReview(base, id)).currentPlan ?? "";
  const line = stored.split("\n").findIndex((text) => text.includes(ANNOTATION_ANCHOR)) + 1;
  if (line === 0) {
    throw new Error(
      `caret assets: the still's annotation anchor ${JSON.stringify(ANNOTATION_ANCHOR)} is not in ` +
        "the stored plan — update ANNOTATION_ANCHOR or scripts/tasks/dev/demo-plan.md",
    );
  }
  const res = await fetch(`${base}/api/reviews/${id}/draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      annotations: [{ id: "assets-1", startLine: line, endLine: line, comment: ANNOTATION_BODY }],
    }),
  });
  if (!res.ok) throw new Error(`caret assets: PUT /draft → ${res.status}`);
}

/**
 * Capture one band's frame, and the palette it resolved to.
 *
 * Both tokens are read off the live document root rather than copied as hexes,
 * so they follow `ui/src/lib/themes/` if a palette changes. `accent` is what the
 * seams are stroked in; `paper` is what proves the theme took — an id this
 * module got wrong is not an error anywhere in the UI, because `definePref`
 * (ui/src/lib/definePref.ts) validates the slot against its allow-list and
 * degrades to the scheme's default, and `paintTheme` stamps `data-theme` with
 * the scheme rather than the id. So the resolved background is the only handle,
 * and the caller compares them.
 */
async function captureBand(
  browser: Browser,
  base: string,
  band: (typeof BANDS)[number],
  path: string,
): Promise<{ accent: string; paper: string }> {
  const context = await browser.newContext({
    viewport: { width: FRAME.width, height: FRAME.height },
    deviceScaleFactor: STITCH_SCALE,
    colorScheme: band.scheme,
  });
  try {
    await pinAppearance(context, band);
    const page = await context.newPage();
    await page.goto(base);
    await planSurface(page);
    // The comment card is the point of the shot; a capture without it is a bug.
    await oneComment(page).waitFor({ state: "visible" });
    const tokens = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        accent: root.getPropertyValue("--accent").trim(),
        paper: root.getPropertyValue("--paper").trim(),
      };
    });
    await page.screenshot({ path });
    return tokens;
  } finally {
    await context.close();
  }
}

export async function runAssetsStitch(): Promise<never> {
  const magick = resolveTool(Bun.which, "magick", "imagemagick");
  await ensurePrereqs();
  const { chromium } = await import("@playwright/test");
  const work = mkdtempSync(join(tmpdir(), "caret-assets-stitch."));
  try {
    await withDaemon(async (base) => {
      await seedStill(base);
      const browser = await chromium.launch();
      let accent = "";
      const papers = new Map<string, string>();
      try {
        for (const [i, band] of BANDS.entries()) {
          const shot = join(work, `capture-${i}.png`);
          const tokens = await captureBand(browser, base, band, shot);
          if (i === 0) accent = tokens.accent;
          // A band that painted a palette another band already painted means an
          // id in BANDS no longer resolves, which the UI answers by silently
          // falling back — so it is caught here or not at all.
          const twin = papers.get(tokens.paper);
          if (twin !== undefined) {
            throw new Error(
              `caret assets: ${band.theme} resolved to the same palette as ${twin} — ` +
                "is that still a theme id in ui/src/lib/theme.ts?",
            );
          }
          papers.set(tokens.paper, band.theme);
          console.log(`assets stitch: captured ${band.theme}`);
        }
      } finally {
        await browser.close();
      }
      if (!accent) throw new Error("caret assets: the UI resolved no --accent to seam with");

      // The captures are device pixels, so the composite works at the scaled
      // frame — CSS pixels never reach magick.
      const width = FRAME.width * STITCH_SCALE;
      const height = FRAME.height * STITCH_SCALE;

      const polygons = seamPolygons(width, height, BANDS.length);
      const layers = [join(work, "capture-0.png")];
      for (const [i, polygon] of polygons.entries()) {
        const out = join(work, `band-${i + 1}.png`);
        const capture = join(work, `capture-${i + 1}.png`);
        await run(bandCommand(magick, width, height, capture, polygon, out));
        layers.push(out);
      }
      const lines = seamLines(width, height, BANDS.length);
      await run(stitchCommand(magick, layers, accent, lines, 3 * STITCH_SCALE, STITCH_PATH));
      console.log(`assets stitch: wrote ${STITCH_PATH} (${width}x${height})`);
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  process.exit(0);
}

/** Run a command, failing loudly on a non-zero exit — every one of these is a
 * composite step whose output the next step reads. */
async function run(cmd: string[]): Promise<void> {
  const code = await runForward(cmd);
  if (code !== 0) throw new Error(`caret assets: \`${cmd[0]} …\` exited ${code}`);
}

// --- assets video ------------------------------------------------------------

/** The recording's session id — one thread, so the revision the agent appends
 * lands on the review the reviewer is already looking at. */
const DEMO_SESSION = "caret-assets-demo";

/** The plan the agent comes back with once the first one is approved: the same
 * fixture under a follow-up title, so the closing frame reads as the agent
 * picking up rather than as the same plan re-appearing. */
const FOLLOW_UP_TITLE = "Wire the `--quiet` flag into the CI release job";
// A function replacement, not a template string: `$&` and friends in a title
// would otherwise be expanded as replacement patterns (the same reason
// `extraPlan` in scripts/tasks/dev/protocol.ts takes one).
const followUpPlan = (plan: string): string =>
  plan.replace(/^# .*$/m, () => `# ${FOLLOW_UP_TITLE}`);

/** A one-shot latch: a promise plus the call that resolves it. The recording uses
 * one to hold a frame the agent would otherwise race past. */
function latch(): { held: Promise<void>; release: () => void } {
  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

/**
 * Play the agent's side of the recording through the real hook path, forever.
 *
 * This is the dev driver's loop (scripts/tasks/dev/driver.ts) with the recording's
 * session and cwd: Request changes really appends a `## Revision N` section quoting
 * the reviewer and reposts as v2, and Approve really unblocks and lets the agent
 * send its next plan. Never resolves under normal operation — it dies with the
 * process at teardown, like the dev driver it mirrors.
 *
 * `emptyStateSeen` is the one departure, and it buys determinism rather than
 * cosmetics: a real agent reposts the instant its plan is approved, but the UI
 * only learns the queue emptied on its next 2s poll tick, so the empty state can
 * be skipped entirely — and a beat that sometimes does not render is a beat the
 * recording cannot wait on. Holding the follow-up until the recording has the
 * frame makes it evidence again.
 */
async function playAgent(base: string, plan: string, emptyStateSeen: Promise<void>): Promise<void> {
  const deps = devReviewDeps(base);
  const followUp = followUpPlan(plan);
  let state: DriverState = { plan, revision: 0 };
  for (;;) {
    const out = await runReview(hookStdin(state.plan, DEMO_SESSION, DEMO_CWD), deps);
    const next = nextPlan(state, out, followUp);
    if (next.action === "wait") return;
    if (next.action === "reseed") await emptyStateSeen;
    state = next;
  }
}

/** A fixed dot that follows the pointer, with a press pulse. Playwright renders
 * no cursor of its own, so without this the recording shows dialogs opening with
 * nothing visible causing them. */
const POINTER_OVERLAY = () => {
  const dot = document.createElement("div");
  dot.style.cssText = [
    "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none",
    "width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%",
    "background:rgba(255,143,61,.45);border:2px solid rgba(255,255,255,.92)",
    "box-shadow:0 1px 6px rgba(0,0,0,.45);transition:transform .08s ease-out",
  ].join(";");
  const attach = () => {
    document.body.appendChild(dot);
    addEventListener(
      "mousemove",
      (event: MouseEvent) => {
        dot.style.left = `${event.clientX}px`;
        dot.style.top = `${event.clientY}px`;
      },
      true,
    );
    addEventListener("mousedown", () => (dot.style.transform = "scale(1.7)"), true);
    addEventListener("mouseup", () => (dot.style.transform = "scale(1)"), true);
  };
  if (document.body) attach();
  else addEventListener("DOMContentLoaded", attach);
};

/** How long the recording rests on a beat that just landed, so a viewer can read
 * the state change before the next gesture starts; `beats` lengthens the hold for
 * the ones worth reading. Deliberate pacing, not a wait for a condition — every
 * beat below already waits on its own evidence. */
const dwell = (beats = 1): Promise<void> => Bun.sleep(1_200 * beats);

/** Move to a target and click it at human speed, so the recording shows the
 * pointer travel rather than teleporting between gestures. */
async function glideClick(page: Page, target: Locator): Promise<void> {
  await target.waitFor({ state: "visible" });
  // `visible` is a DOM predicate, not a viewport one, so an off-screen target
  // would hand back coordinates the mouse then clicks something else at.
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("caret assets: the click target has no box on screen");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 26 });
  await page.mouse.down();
  await page.mouse.up();
}

/** The viewport y of the plan row carrying `needle`. Resolved through the
 * library's own row contract (test/e2e/support/source-view.ts resolves the same
 * one), and fatal on a miss so a fixture edit fails here rather than as a click
 * that lands on whatever happened to sit at those coordinates. */
async function rowCenterY(page: Page, needle: string): Promise<number> {
  const y = await page.evaluate((want) => {
    const shadow = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const row = [...(shadow?.querySelectorAll("[data-content] [data-line]") ?? [])].find((r) =>
      (r.textContent ?? "").includes(want),
    );
    const rect = row?.getBoundingClientRect();
    return rect ? rect.y + rect.height / 2 : null;
  }, needle);
  if (y === null) throw new Error(`caret assets: no plan row carries ${JSON.stringify(needle)}`);
  return y;
}

/** Poll until a pending review has reached `version`. The agent's repost is a
 * round trip through the daemon, so the UI beat that follows has something real
 * to wait on rather than a sleep. */
async function waitForVersion(base: string, version: number): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const list = await json<ClientReview[]>(await fetch(`${base}/api/reviews`), "GET /api/reviews");
    if (list.some((r) => r.status === "pending" && r.version >= version)) return;
    await Bun.sleep(50);
  }
  throw new Error(`caret assets: no pending review reached version ${version}`);
}

/**
 * Drive the review arc, one beat at a time.
 *
 * Every beat waits on the DOM evidence that it landed rather than on a sleep, so
 * each leaves proof it happened: a beat that silently did nothing fails here
 * instead of producing a recording of an idle window. Where a beat's evidence is
 * inside the plan's own scroll container, the wheel gesture that puts it on
 * screen is followed by `scrollIntoViewIfNeeded` — a Playwright locator counts as
 * visible off-viewport, so the wheel amount alone would be a silent bet on the
 * fixture's current length. Settings, theme switching and the compare view stay
 * out of shot.
 */
async function playReview(page: Page, base: string, releaseFollowUp: () => void): Promise<void> {
  await page.goto(base);
  const surface = await planSurface(page);
  await page.getByText(PLAN_TITLE_FRAGMENT).first().waitFor({ state: "visible" });

  // A short read before touching anything — the reviewer skimming the plan.
  await dwell();
  await surface.hover();
  await page.mouse.wheel(0, 220);
  await dwell();

  // The gutter `+` appears only on hover, so the pointer travels to the row first.
  const box = await surface.boundingBox();
  if (!box) throw new Error("caret assets: the plan surface has no box on screen");
  await page.mouse.move(box.x + 6, await rowCenterY(page, ANNOTATION_ANCHOR), { steps: 26 });
  await glideClick(page, page.locator(".diffview [data-utility-button]"));

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await composer.waitFor({ state: "visible" });
  await composer.getByRole("textbox", { name: "Comment" }).click();
  await page.keyboard.type(ANNOTATION_BODY, { delay: 45 });
  await glideClick(page, composer.getByRole("button", { name: "Comment", exact: true }));
  await oneComment(page).waitFor({ state: "visible" });
  await dwell();

  // Send it back: the inline comment rides the request-changes dialog to the agent.
  await glideClick(page, page.getByRole("button", { name: "Request changes" }));
  const dialog = page.getByRole("dialog", { name: "Send the plan back for revision" });
  await dialog.waitFor({ state: "visible" });
  await dwell();
  await dialog.getByRole("textbox", { name: "General comment" }).click();
  await page.keyboard.type("Otherwise this reads well — one more pass.", { delay: 45 });
  await glideClick(page, dialog.getByRole("button", { name: "Send for revision" }));

  // The agent revises and reposts: v2 arrives in the still-open window, carrying
  // a Revision section that quotes the feedback back.
  await waitForVersion(base, 2);
  const revision = page.getByText("Revision 1").first();
  await revision.waitFor({ state: "visible" });
  await surface.hover();
  await page.mouse.wheel(0, 3000);
  await revision.scrollIntoViewIfNeeded();
  await dwell();

  await glideClick(page, page.getByRole("button", { name: "Approve", exact: true }));
  const confirm = page.getByRole("dialog", { name: "Approve this plan?" });
  await confirm.waitFor({ state: "visible" });
  await dwell();
  await glideClick(page, confirm.getByRole("button", { name: "Approve", exact: true }));
  await page
    .getByRole("heading", { name: "No plans awaiting review" })
    .waitFor({ state: "visible" });
  await dwell();
  releaseFollowUp();

  // The follow-up opens where the previous plan was left, so send it back to its
  // heading — the closing frame is the payoff, not a half-empty page.
  await page.getByText(FOLLOW_UP_TITLE).first().waitFor({ state: "visible" });
  await surface.evaluate((el) => el.scrollTo({ top: 0 }));
  await dwell(2);
}

/**
 * Capture frames for as long as `body` runs, and report the rate they landed at.
 *
 * A screenshot loop rather than Playwright's own `recordVideo`, because the
 * recorder captures the screencast at CSS-pixel resolution and ignores
 * `deviceScaleFactor` — asking it for a larger frame pads and upscales rather
 * than rendering more detail, so 13px monospace can never come out sharp.
 * `page.screenshot` does honour the scale factor, so this is the only path to a
 * genuinely high-resolution recording.
 *
 * The rate is measured rather than assumed: a screenshot at this size costs
 * ~50ms and the gestures contend for the same CDP session, so the real interval
 * drifts. Handing the measured rate to the encoder is what keeps playback at
 * real time instead of subtly fast or slow.
 */
async function captureFrames(
  page: Page,
  dir: string,
  body: () => Promise<void>,
): Promise<{ frames: number; fps: number }> {
  let capturing = true;
  let frames = 0;
  const started = Bun.nanoseconds();
  const loop = (async () => {
    while (capturing) {
      try {
        const shot = await page.screenshot({ type: "jpeg", quality: 90 });
        await Bun.write(join(dir, `f-${String(frames++).padStart(5, "0")}.jpg`), shot);
      } catch {
        // The page is closing, or a gesture holds the session — drop the frame
        // rather than failing a recording over one.
      }
      // No pacing sleep: a screenshot at this size already costs more than a
      // frame's worth of wall clock, so the loop's own latency IS the interval.
      // Yielding keeps it from starving the gestures it is recording.
      await Bun.sleep(0);
    }
  })();
  try {
    await body();
  } finally {
    capturing = false;
    await loop;
  }
  const seconds = Number(Bun.nanoseconds() - started) / 1e9;
  if (frames < 2) throw new Error("caret assets: the capture loop produced no frames");
  return { frames, fps: frames / seconds };
}

export async function runAssetsVideo(): Promise<never> {
  const ffmpeg = resolveTool(Bun.which, "ffmpeg", "ffmpeg");
  await ensurePrereqs();
  const { chromium } = await import("@playwright/test");
  const work = mkdtempSync(join(tmpdir(), "caret-assets-video."));
  let seconds = "0.0";
  try {
    await withDaemon(async (base, stateDir) => {
      // The agent side runs in THIS process, so point it at the isolated state
      // dir before it starts: the hook's own logging (runReview → caret.log, read
      // lazily off process.env) would otherwise write to the real
      // ~/.local/state/caret. Same reason scripts/tasks/dev/run.ts does it.
      process.env.XDG_STATE_HOME = stateDir;
      const followUp = latch();
      void playAgent(base, await demoPlan(), followUp.held).catch((err) => {
        process.stderr.write(`assets video: agent side stopped: ${err}\n`);
      });

      const browser = await chromium.launch({ slowMo: 260 });
      const context = await browser.newContext({
        viewport: { ...VIDEO_VIEWPORT },
        deviceScaleFactor: VIDEO_SCALE,
        colorScheme: BANDS[0].scheme,
      });
      await pinAppearance(context, BANDS[0]);
      await context.addInitScript(POINTER_OVERLAY);
      const page = await context.newPage();
      let captured: { frames: number; fps: number };
      try {
        captured = await captureFrames(page, work, () => playReview(page, base, followUp.release));
      } finally {
        // A failed beat must not leave the agent parked on the latch forever.
        followUp.release();
        await context.close();
        await browser.close();
      }
      seconds = (captured.frames / captured.fps).toFixed(1);
      await run(encodeCommand(ffmpeg, captured.fps, join(work, "f-%05d.jpg"), VIDEO_PATH));
      console.log(
        `assets video: ${captured.frames} frames at ${captured.fps.toFixed(1)}fps, ` +
          `${VIDEO_VIEWPORT.width * VIDEO_SCALE}x${VIDEO_VIEWPORT.height * VIDEO_SCALE}`,
      );
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  // The one criterion no assertion covers — "no longer than about a minute" — is
  // checkable from this line without adding an ffprobe dependency.
  console.log(`assets video: wrote ${VIDEO_PATH} (${seconds}s of recording)`);
  process.exit(0);
}

// --- prerequisites -----------------------------------------------------------

/** Build the UI (so the daemon serves a current ui/dist) and prove Chromium is
 * installed, before anything spends a minute driving a browser. */
async function ensurePrereqs(): Promise<void> {
  const ui = await ensureUi();
  if (ui !== 0) throw new Error("caret assets: the UI build failed");
  if (!(await chromiumInstalled())) {
    throw new Error(
      "caret assets: Chromium is not installed. Run: mise run setup  " +
        "(or: bunx playwright install chromium)",
    );
  }
}

// --- assets (umbrella) -------------------------------------------------------

/** Bare `mise run assets`. Stitch runs first because it is the cheap one: a
 * failure there costs seconds, where the same failure after the recording costs
 * the recording. */
export async function assetsPlan(run: typeof runForward = runForward): Promise<number> {
  return await runTargetsAfterUi("assets", ["stitch", "video"], run);
}

export async function runAssets(): Promise<never> {
  process.exit(await assetsPlan());
}
