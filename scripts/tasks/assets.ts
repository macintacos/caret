// `assets` task (EXC-805): regenerate the README's hero, one screenshot of the
// review UI per appearance, so refreshing it after the UI moves is a task run
// rather than a hand-composed screenshot.
//
// It lives under scripts/tasks/ rather than test/e2e/ deliberately: a generator
// is not a spec, and a file under test/e2e/ matching `**/*.e2e.ts` would be swept
// into `mise run preflight`. For the same reason it drives the browser through
// the Playwright LIBRARY (chromium.launch) instead of the test runner, which
// would need a second config to collect it.
//
// Nothing else here is a new subsystem. The isolated daemon boot is
// scripts/tasks/dev/run.ts's (childEnvFor, daemonCommand, makeCleanup,
// discoverPort). The fixtures it stages on are pinned against the demo plan in
// test/scripts/assets.test.ts.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Browser, BrowserContext, Page } from "@playwright/test";

import { isPidAlive } from "@/daemon/lifecycle.ts";
import type { ClientReview, RouteResult } from "@/lib/types.ts";
import { ensureUi } from "@/tasks/build.ts";
import { discoverPort, readDevLockPort } from "@/tasks/dev/dev-env.ts";
import { childEnvFor, daemonCommand, makeCleanup } from "@/tasks/dev/run.ts";
import { installCleanupHandlers } from "@/tasks/lib/signals.ts";
import { chromiumInstalled } from "@/tasks/test.ts";

// --- the shots ---------------------------------------------------------------

/** The frame in CSS pixels. Beside a drawer this wide the outline column folds,
 * so the shot is the plan beside the file it cites. */
const FRAME = { width: 1440, height: 900 } as const;

/** The drawer's width in CSS pixels, written to the pref the app remembers it in.
 * The default share would clip the plan's 90-column lines at this frame, and the
 * preview's lines are kept short enough to fit. */
const DRAWER_WIDTH = 560;

/** Device pixels per CSS pixel, so the committed hero is crisp on a high-DPI
 * display rather than upscaled by the browser showing it. */
const SCALE = 2;

/** One shot per appearance. Each pins its theme in its scheme's slot
 * (ui/src/lib/appearance.ts), so a change to a slot's default can't change the hero. */
const SHOTS = [
  { theme: "caret-light", scheme: "light" },
  { theme: "caret-dark", scheme: "dark" },
] as const;

type Shot = (typeof SHOTS)[number];

const shotPath = (shot: Shot): string => `doc/assets/caret-review-ui-${shot.scheme}.png`;

/** The cwd the picture shows. The browser is handed this literal in place of the
 * real project directory, which only the daemon sees, so no contributor path,
 * hostname, or temp directory can reach a committed asset. */
const DEMO_CWD = "~/acme-web";

/** The file the drawer previews: the logger the demo plan cites, written into the
 * project directory the daemon resolves references against. `ref` is the plan's
 * citation; its line suffix is `createLogger`, which the first comment is about. */
export const PREVIEW_FILE = {
  path: "scripts/release/log.ts",
  ref: "scripts/release/log.ts:9",
  content: `export type Level = "info" | "warn" | "error";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function createLogger(): Logger {
  const write = (level: Level, message: string) => {
    const line = \`\${level.padEnd(5)} \${message}\`;
    if (level === "info") console.log(line);
    else console.error(line);
  };
  return {
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error: (message) => write("error", message),
  };
}
`,
} as const;

/** The two inline comments, each on the one line of the demo plan holding its
 * `anchor`. Matched against the STORED plan (the daemon reflows every plan at
 * ingest), and a miss is fatal so a fixture edit can't silently drop a card. */
export const ANNOTATIONS = [
  {
    anchor: PREVIEW_FILE.ref,
    body: "pass `quiet` into `createLogger` rather than reading a global.",
  },
  {
    anchor: '3. Keep the closing "published vX.Y.Z" line unconditional.',
    body: "say what `--quiet` does to this line when the publish step fails.",
  },
] as const;

// --- the isolated daemon -----------------------------------------------------

/** Boot a caret daemon on an OS-assigned port with its own ephemeral state dir,
 * run `body` against it, and reap both. The same boot `mise run dev` performs,
 * minus Vite and the supervision loop: the daemon serves the built ui/dist, which
 * is what makes the captures show the shipped UI rather than a dev server's. */
async function withDaemon<T>(body: (base: string, stateDir: string) => Promise<T>): Promise<T> {
  // Canonical, so a daemon that realpaths a cwd still echoes the string the
  // browser-side cwd swap looks for.
  const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "caret-assets.")));
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
async function postPlan(base: string, plan: string, cwd: string): Promise<string> {
  const res = await fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "caret-assets", cwd, plan }),
  });
  return (await json<RouteResult>(res, "POST /api/reviews")).id;
}

const getReview = async (base: string, id: string): Promise<ClientReview> =>
  json<ClientReview>(await fetch(`${base}/api/reviews/${id}`), `GET /api/reviews/${id}`);

/** Write the demo project the review's references resolve against. */
function writeProject(projectDir: string): void {
  const file = join(projectDir, PREVIEW_FILE.path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, PREVIEW_FILE.content);
}

/** Seed the review: the demo plan, from `projectDir`, with both comments drafted
 * on it. Anchored against the STORED plan — the daemon reflows every plan at
 * ingest, so a line counted off the fixture does not index what is served. */
async function seedReview(base: string, projectDir: string): Promise<void> {
  const id = await postPlan(base, await demoPlan(), projectDir);
  const stored = ((await getReview(base, id)).currentPlan ?? "").split("\n");
  const annotations = ANNOTATIONS.map(({ anchor, body }, i) => {
    const line = stored.findIndex((text) => text.includes(anchor)) + 1;
    if (line === 0) {
      throw new Error(
        `caret assets: the comment anchor ${JSON.stringify(anchor)} is not in the stored plan — ` +
          "update ANNOTATIONS or scripts/tasks/dev/demo-plan.md",
      );
    }
    return { id: `assets-${i + 1}`, startLine: line, endLine: line, comment: body };
  });
  const res = await fetch(`${base}/api/reviews/${id}/draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ annotations }),
  });
  if (!res.ok) throw new Error(`caret assets: PUT /draft → ${res.status}`);
}

// --- the browser -------------------------------------------------------------

/** Pin the prefs before the app boots: the appearance, the drawer's width, and the
 * first-run onboarding modal and drag tip marked seen so neither covers the shot.
 * Written straight to the keys their modules own, rather than clicked through
 * Settings and dragged. */
async function pinPrefs(context: BrowserContext, shot: Shot): Promise<void> {
  await context.addInitScript(
    (prefs: Record<string, string>) => {
      for (const [key, value] of Object.entries(prefs)) localStorage.setItem(key, value);
    },
    {
      "caret.theme.mode": shot.scheme,
      [shot.scheme === "dark" ? "caret.theme.dark" : "caret.theme.light"]: shot.theme,
      "caret.fileDrawer.width": String(DRAWER_WIDTH),
      "caret.onboarded": "1",
      "caret:diffview:drag-hint-dismissed": "1",
      "caret.planView": "source",
      "caret.previewDefault.moved": "1",
      "caret.previewDefault.noticeSeen": "1",
    },
  );
}

/** Swap the real project directory for `DEMO_CWD` in the review JSON the UI
 * reads: the list and one review. The file routes still resolve against the real
 * directory, because the daemon keeps it. */
async function showDemoCwd(context: BrowserContext, projectDir: string): Promise<void> {
  await context.route(/\/api\/reviews(\/[^/?]+)?$/, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replaceAll(projectDir, DEMO_CWD);
    await route.fulfill({ response, body });
  });
}

/** The status strip's tally, once it reads `n` comments — the proof the drafts
 * reached the review. Anchored, because `getByRole`'s string form matches the
 * accessible name as a substring, so "2 comments" would also collect "12 comments".
 * Re-derived rather than imported from `test/e2e/support/chrome.ts`: a task module
 * reaching into `test/` inverts the dependency the whole tree assumes. */
const tally = (page: Page, n: number): Promise<void> =>
  page.getByRole("button", { name: new RegExp(`^${n} comments$`) }).waitFor();

/** Stage the frame: the plan, its comments, the cited file open in the drawer, and
 * the comment navigator ⇧C opens. Each wait is on what the shot must show, so a
 * capture missing any of it fails rather than committing. */
async function stage(page: Page): Promise<void> {
  await page.locator(".diff-plan").waitFor({ state: "visible" });
  // The pill must show exactly DEMO_CWD; anything else there is the real directory.
  // It also holds the whole path unseen, to size itself, so match the visible text.
  await page
    .getByRole("button", { name: /^Copy path / })
    .getByText(DEMO_CWD, { exact: true })
    .filter({ visible: true })
    .waitFor();
  await tally(page, ANNOTATIONS.length);
  // Resolution is a daemon round-trip, so the reference is tagged after the plan
  // paints.
  await page.locator("[data-file-ref]").first().click();
  await page.locator("[data-file-preview]").waitFor({ state: "visible" });
  await page.keyboard.press("Shift+C");
  await page.locator("#comment-navigator").waitFor({ state: "visible" });
  // ⇧C shows its toggle pressed for a moment; shoot it at rest.
  await page.locator("[data-key-pressed]").waitFor({ state: "detached" });
  // The click left the pointer over the plan, whose hover follows it; the top bar's
  // gap between the title and the actions shows no hover.
  await page.mouse.move(FRAME.width / 2, 24);
}

/** Capture one shot. Reduced motion lands every opening slide at rest, so the
 * frame is taken where it settles. */
async function captureShot(browser: Browser, base: string, projectDir: string, shot: Shot) {
  const context = await browser.newContext({
    viewport: FRAME,
    deviceScaleFactor: SCALE,
    colorScheme: shot.scheme,
    reducedMotion: "reduce",
  });
  try {
    await pinPrefs(context, shot);
    await showDemoCwd(context, projectDir);
    const page = await context.newPage();
    await page.goto(base);
    await stage(page);
    await page.screenshot({ path: shotPath(shot) });
  } finally {
    await context.close();
  }
}

export async function runAssets(): Promise<never> {
  await ensurePrereqs();
  const { chromium } = await import("@playwright/test");
  await withDaemon(async (base, stateDir) => {
    const projectDir = join(stateDir, "acme-web");
    writeProject(projectDir);
    await seedReview(base, projectDir);
    const browser = await chromium.launch();
    try {
      for (const shot of SHOTS) {
        await captureShot(browser, base, projectDir, shot);
        console.log(`assets: wrote ${shotPath(shot)} (${shot.theme})`);
      }
    } finally {
      await browser.close();
    }
  });
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
