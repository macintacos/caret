// `assets` task (EXC-805): regenerate the README's hero image — a four-theme
// diagonal stitch of the plan view — so refreshing it after the UI moves is a task
// run rather than a hand-composed screenshot.
//
// It lives under scripts/tasks/ rather than test/e2e/ deliberately: a generator
// is not a spec, and a file under test/e2e/ matching `**/*.e2e.ts` would be swept
// into `mise run preflight`. For the same reason it drives the browser through
// the Playwright LIBRARY (chromium.launch) instead of the test runner, which
// would need a second config to collect it.
//
// Nothing else here is a new subsystem. The isolated daemon boot is
// scripts/tasks/dev/run.ts's (childEnvFor, daemonCommand, makeCleanup,
// discoverPort). The pure halves — the tool lookup, the seam geometry, the argv —
// are unit-tested in test/scripts/assets.test.ts.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";

import { isPidAlive } from "@/daemon/lifecycle.ts";
import type { ClientReview, RouteResult } from "@/lib/types.ts";
import { ensureUi } from "@/tasks/build.ts";
import { discoverPort, readDevLockPort } from "@/tasks/dev/dev-env.ts";
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

/** The cwd the reviewed plan claims to come from. Two segments, so `shortCwd`
 * (ui/src/lib/cwd.ts) renders it whole rather than eliding to `…/parent/leaf` —
 * and no contributor path, hostname, or project name can reach a committed asset. */
const DEMO_CWD = "~/acme-web";

/** The line of the demo plan the still's inline comment anchors to. Matched
 * against the STORED plan (the daemon reflows every plan at ingest), and a miss
 * is fatal so a fixture edit can't silently drop the comment card from the hero.
 * Exported because `test/scripts/assets.test.ts` pins it against
 * `scripts/tasks/dev/demo-plan.md` — that file is listed in preflight's
 * MARKDOWN_READ_BY_TESTS, so editing it alone still runs the guard. */
export const ANNOTATION_ANCHOR = '3. Keep the closing "published vX.Y.Z" line unconditional.';

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
 * nothing about what to install. ImageMagick is not pinned in `mise.toml`: it has
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

export async function runAssets(): Promise<never> {
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
