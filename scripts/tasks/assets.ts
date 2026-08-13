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
// Nothing here is a new subsystem. The isolated daemon boot is scripts/tasks/dev/
// run.ts's (planStateDir's ephemeral half, childEnvFor, daemonCommand, makeCleanup,
// discoverPort); the agent's side of the recording is the dev driver's real hook
// path (devReviewDeps + runReview + nextPlan), so Request changes really appends a
// revision and Approve really unblocks; the gestures are the ones test/e2e's
// keyboard-commenting / diff-surface / request-changes / approve specs already
// drive. The pure halves — the magick lookup, the seam geometry, the argv — are
// unit-tested in test/scripts/assets.test.ts.
//
// ImageMagick is a host tool, not a pinned mise dependency: it has no `aqua:`
// entry, and the registry alternatives would put a multi-minute build in front of
// every fresh clone.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";

import { isPidAlive } from "@/daemon/lifecycle.ts";
import type { ClientReview, RouteResult } from "@/lib/types.ts";
import { runReview } from "@/review/orchestrate.ts";
import { ensureUi } from "@/tasks/build.ts";
import { discoverPort, readDevLockPort } from "@/tasks/dev/dev-env.ts";
import { devReviewDeps } from "@/tasks/dev/driver.ts";
import { type DriverState, hookStdin, nextPlan } from "@/tasks/dev/protocol.ts";
import { childEnvFor, daemonCommand, makeCleanup } from "@/tasks/dev/run.ts";
import { runForward } from "@/tasks/lib/exec.ts";
import { installCleanupHandlers } from "@/tasks/lib/signals.ts";
import { chromiumInstalled } from "@/tasks/test.ts";

// --- shared shape ------------------------------------------------------------

/** The captured frame. Today's committed asset's exact dimensions, pinned so the
 * four captures' seams line up and so a regeneration is a drop-in replacement. */
export const FRAME = { width: 1440, height: 900 } as const;

/** The recording's frame: a modest 16:10 downscale of FRAME. Every regeneration
 * appends a blob to history forever, so the committed video is smaller than what
 * the browser was driven at. */
const VIDEO_FRAME = { width: 1280, height: 800 } as const;

const STITCH_PATH = "doc/assets/caret-review-ui.png";
const VIDEO_PATH = "doc/assets/caret-review-demo.webm";

/** The cwd the reviewed plan claims to come from. Two segments, so `shortCwd`
 * (ui/src/lib/cwd.ts) renders it whole rather than eliding to `…/parent/leaf` —
 * and no contributor path, hostname, or project name can reach a committed asset. */
const DEMO_CWD = "~/acme-web";

/** The line of the demo plan the still's inline comment anchors to. Matched
 * against the STORED plan (the daemon reflows every plan at ingest), and a miss
 * is fatal so a fixture edit can't silently drop the comment card from the hero. */
const ANNOTATION_ANCHOR = '3. Keep the closing "published vX.Y.Z" line unconditional.';

const ANNOTATION_BODY = "say what `--quiet` does to this line when the publish step fails.";

/** The four palettes, top-left band first: caret's own dark and light lead, then
 * the two community palettes. Each carries the scheme whose slot key holds it
 * (ui/src/lib/appearance.ts), which is what pins the resolved theme without
 * clicking through Settings. */
const BANDS = [
  { theme: "caret-dark", scheme: "dark" },
  { theme: "caret-light", scheme: "light" },
  { theme: "dracula", scheme: "dark" },
  { theme: "catppuccin-mocha", scheme: "dark" },
] as const;

// --- pure helpers ------------------------------------------------------------

/** Resolve the `magick` binary, naming the install when it is absent. Without
 * this the failure surfaces as an ENOENT from a spawn deep inside the composite,
 * which says nothing about what to install. */
export function resolveMagick(which: (cmd: string) => string | null): string {
  const bin = which("magick");
  if (!bin) {
    throw new Error(
      "caret assets: ImageMagick is not on PATH. Install it with `brew install imagemagick` " +
        "(it is a host tool, deliberately not pinned in mise.toml).",
    );
  }
  return bin;
}

/** Where seam k cuts, as the constant of the anti-diagonal `x/width + y/height`.
 * Evenly spaced across the frame's mid-height, so an even band count puts one
 * seam corner to corner — the line today's two-theme shot already uses. */
function seamConstants(bands: number): number[] {
  return Array.from({ length: bands - 1 }, (_, k) => 0.5 + (k + 1) / bands);
}

const point = (x: number, y: number): string => `${Math.round(x)},${Math.round(y)}`;

/** The seams themselves, as magick `x1,y1 x2,y2` draw points — one per cut,
 * spanning the frame's full height. */
export function seamLines(width: number, height: number, bands: number): string[] {
  return seamConstants(bands).map(
    (t) => `${point(width * t, 0)} ${point(width * (t - 1), height)}`,
  );
}

/**
 * The half-plane mask polygon for each band past the first, cut along its seam.
 *
 * Derived from the band count rather than written out as four fixed polygons: the
 * geometry is the same half-plane every time, so taking the form that is less code
 * is also the form that generalizes. Each polygon is the seam segment — extended a
 * frame past both horizontal edges so the mask reaches the corners — swept far in
 * `+x`, which is the side the later band paints on. That keeps it a simple convex
 * quadrilateral, where clipping the half-plane to the frame's own corners would
 * fold into a self-intersecting bowtie for the seams that leave through the side.
 */
export function seamPolygons(width: number, height: number, bands: number): string[] {
  const sweep = 4 * width;
  return seamConstants(bands).map((t) => {
    const top = { x: width * (t + 1), y: -height };
    const bottom = { x: width * (t - 2), y: 2 * height };
    return [
      point(top.x, top.y),
      point(bottom.x, bottom.y),
      point(bottom.x + sweep, bottom.y),
      point(top.x + sweep, top.y),
    ].join(" ");
  });
}

/** Mask one capture down to its band, in a single magick call: the mask is built
 * inline as a parenthesized subimage and copied into the capture's alpha, so no
 * intermediate mask file is written. */
export function bandCommand(
  magick: string,
  capture: string,
  polygon: string,
  out: string,
): string[] {
  return [
    magick,
    capture,
    "(",
    "-size",
    `${FRAME.width}x${FRAME.height}`,
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
 * accent — the divider is caret's own accent rather than a neutral hairline. */
export function stitchCommand(
  magick: string,
  layers: string[],
  accent: string,
  lines: string[],
  out: string,
): string[] {
  return [
    magick,
    ...layers,
    "-flatten",
    "-stroke",
    accent,
    "-strokewidth",
    "4",
    ...lines.flatMap((line) => ["-draw", `line ${line}`]),
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

/** The status strip's comment tally — the proof a comment reached the review.
 * Waiting on the tally rather than on the comment's own text is what makes it
 * hold in both card states: a committed card renders its body as markdown, so a
 * body carrying a code span is not one text node to match against. */
const commentTally = (page: Page): Locator => page.getByRole("button", { name: "1 comment" });

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

/** Capture one band's frame, and (for the first) the live accent the seams are
 * stroked in — read off the document root rather than copied as a hex, so it
 * follows the palette if ui/src/lib/themes/caret.ts changes. */
async function captureBand(
  browser: Browser,
  base: string,
  band: (typeof BANDS)[number],
  path: string,
): Promise<string> {
  const context = await browser.newContext({
    viewport: { width: FRAME.width, height: FRAME.height },
    deviceScaleFactor: 1,
    colorScheme: band.scheme,
  });
  try {
    await pinAppearance(context, band);
    const page = await context.newPage();
    await page.goto(base);
    await planSurface(page);
    // The comment card is the point of the shot; a capture without it is a bug.
    await commentTally(page).waitFor({ state: "visible" });
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
    );
    await page.screenshot({ path });
    return accent;
  } finally {
    await context.close();
  }
}

export async function runAssetsStitch(): Promise<never> {
  const magick = resolveMagick((cmd) => Bun.which(cmd));
  await ensurePrereqs();
  const { chromium } = await import("@playwright/test");
  const work = mkdtempSync(join(tmpdir(), "caret-assets-stitch."));
  try {
    await withDaemon(async (base) => {
      await seedStill(base);
      const browser = await chromium.launch();
      let accent = "";
      try {
        for (const [i, band] of BANDS.entries()) {
          const shot = join(work, `capture-${i}.png`);
          const read = await captureBand(browser, base, band, shot);
          if (i === 0) accent = read;
          console.log(`assets stitch: captured ${band.theme}`);
        }
      } finally {
        await browser.close();
      }

      // Band 0 is the whole frame; each later band is masked to the far side of
      // its seam and flattened over what is already there.
      const polygons = seamPolygons(FRAME.width, FRAME.height, BANDS.length);
      const layers = [join(work, "capture-0.png")];
      for (const [i, polygon] of polygons.entries()) {
        const out = join(work, `band-${i + 1}.png`);
        await run(bandCommand(magick, join(work, `capture-${i + 1}.png`), polygon, out));
        layers.push(out);
      }
      const lines = seamLines(FRAME.width, FRAME.height, BANDS.length);
      await run(stitchCommand(magick, layers, accent || "#ff8f3d", lines, STITCH_PATH));
      console.log(`assets stitch: wrote ${STITCH_PATH} (${FRAME.width}x${FRAME.height})`);
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
const followUpPlan = (plan: string): string => plan.replace(/^# .*$/m, `# ${FOLLOW_UP_TITLE}`);

/**
 * Play the agent's side of the recording through the real hook path, forever.
 *
 * This is the dev driver's loop (scripts/tasks/dev/driver.ts) with the recording's
 * session and cwd: Request changes really appends a `## Revision N` section quoting
 * the reviewer and reposts as v2, and Approve really unblocks and lets the agent
 * send its next plan. Never resolves under normal operation — it dies with the
 * process at teardown, like the dev driver it mirrors.
 */
async function playAgent(base: string, plan: string): Promise<void> {
  const deps = devReviewDeps(base);
  const followUp = followUpPlan(plan);
  let state: DriverState = { plan, revision: 0 };
  for (;;) {
    const out = await runReview(hookStdin(state.plan, DEMO_SESSION, DEMO_CWD), deps);
    const next = nextPlan(state, out, followUp);
    if (next.action === "wait") return;
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
 * the state change before the next gesture starts. Deliberate pacing, not a wait
 * for a condition — every beat below already waits on its own evidence. */
const dwell = (): Promise<void> => Bun.sleep(1_200);

/** Move to a target and click it at human speed, so the recording shows the
 * pointer travel rather than teleporting between gestures. */
async function glideClick(page: Page, target: Locator): Promise<void> {
  await target.waitFor({ state: "visible" });
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
 * Every beat waits on its own on-screen evidence rather than a sleep, so each
 * leaves proof it happened: a beat that silently did nothing fails here instead
 * of producing a recording of an idle window. Settings, theme switching and the
 * compare view stay out of shot.
 */
async function playReview(page: Page, base: string): Promise<void> {
  await page.goto(base);
  const surface = await planSurface(page);
  await page.getByText("Add a `--quiet` flag").first().waitFor({ state: "visible" });

  // A short read before touching anything — the reviewer skimming the plan.
  await dwell();
  await surface.hover();
  await page.mouse.wheel(0, 220);
  await dwell();

  // Comment: reveal the gutter `+` on the line worth commenting on, open the
  // composer, type, and commit it.
  const box = await surface.boundingBox();
  if (!box) throw new Error("caret assets: the plan surface has no box on screen");
  await page.mouse.move(box.x + 6, await rowCenterY(page, ANNOTATION_ANCHOR), { steps: 26 });
  await glideClick(page, page.locator(".diffview [data-utility-button]"));

  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await composer.waitFor({ state: "visible" });
  await composer.getByRole("textbox", { name: "Comment" }).click();
  await page.keyboard.type(ANNOTATION_BODY, { delay: 45 });
  await glideClick(page, composer.getByRole("button", { name: "Comment", exact: true }));
  await commentTally(page).waitFor({ state: "visible" });
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
  await surface.hover();
  await page.mouse.wheel(0, 3000);
  await page.getByText("Revision 1").first().waitFor({ state: "visible" });
  await dwell();

  // Approve, through the confirmation every approve routes through.
  await glideClick(page, page.getByRole("button", { name: "Approve", exact: true }));
  const confirm = page.getByRole("dialog", { name: "Approve this plan?" });
  await confirm.waitFor({ state: "visible" });
  await dwell();
  await glideClick(page, confirm.getByRole("button", { name: "Approve", exact: true }));
  await page
    .getByRole("heading", { name: "No plans awaiting review" })
    .waitFor({ state: "visible" });
  await dwell();

  // ...and the agent picks back up: its next plan lands in the same window.
  await page.getByText(FOLLOW_UP_TITLE).first().waitFor({ state: "visible" });
  await dwell();
}

export async function runAssetsVideo(): Promise<never> {
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
      void playAgent(base, await demoPlan()).catch((err) => {
        process.stderr.write(`assets video: agent side stopped: ${err}\n`);
      });

      const browser = await chromium.launch({ slowMo: 260 });
      const context = await browser.newContext({
        viewport: { width: FRAME.width, height: FRAME.height },
        deviceScaleFactor: 1,
        colorScheme: BANDS[0].scheme,
        recordVideo: { dir: work, size: { ...VIDEO_FRAME } },
      });
      await pinAppearance(context, BANDS[0]);
      await context.addInitScript(POINTER_OVERLAY);
      const page = await context.newPage();
      const started = Bun.nanoseconds();
      try {
        await playReview(page, base);
      } finally {
        // The video is only finalized once the context closes.
        seconds = (Number(Bun.nanoseconds() - started) / 1e9).toFixed(1);
        await context.close();
        await browser.close();
      }
      const recorded = await page.video()?.path();
      if (!recorded) throw new Error("caret assets: Chromium recorded no video");
      await Bun.write(VIDEO_PATH, Bun.file(recorded));
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

export async function runAssets(): Promise<never> {
  // Stitch first: it is the target that needs ImageMagick, so a missing host tool
  // fails in the first seconds rather than after the recording.
  const stitch = await runForward(["bun", "scripts/tasks/cli.ts", "assets", "stitch"]);
  if (stitch !== 0) process.exit(stitch);
  process.exit(await runForward(["bun", "scripts/tasks/cli.ts", "assets", "video"]));
}
