// Shared Playwright fixture: one isolated caret daemon per test.
//
// Per-test (not per-run) because the review list is global daemon state and
// several specs assert exact review sets (switcher = exactly two, deep link,
// poll pickup); there is no DELETE endpoint to clean a shared daemon between
// tests. Boot is ~64ms serial and ~137ms at six workers, and OS-assigned ports
// (daemon-entry.ts) make fullyParallel workers collision-free. The fixture runs
// under the Playwright (node) runner; only the daemon child needs Bun, so it is
// spawned with `bun` explicitly.
//
// Boot is not the whole cost a test pays for its daemon: the first seed() adds
// ~11ms on top, and that figure holds only because pinnedRumdl() below hands the
// daemon a pre-resolved binary rather than letting it acquire rumdl to format
// its plan (EXC-1053).

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { test as base, expect, type Locator, type Page } from "@playwright/test";

import { KEY_REPEAT_DELAY_MS } from "@ui/src/lib/keyRepeat.ts";
import { waitForHealth } from "@/daemon/client.ts";
import type {
  ClientReview,
  DraftBody,
  PlanInput,
  PrefsPatch,
  RouteResult,
  UpdateStatus,
} from "@/lib/types.ts";
import { RUMDL_VERSION } from "@/plan/rumdl.ts";

import { FIXTURE_PLAN } from "./fixture-plan.ts";

export interface Daemon {
  /** Base URL of this test's daemon (http://127.0.0.1:<os-assigned-port>). */
  url: string;
  /**
   * Seed a review through the public API — the same POST /api/reviews the hook
   * makes, issued harness-side (no Origin header, so the same-origin guard is
   * unaffected). `sessionId` defaults to a fresh UUID per call: the daemon
   * SUPERSEDES a same-session pending review, so two seeds sharing a session
   * would silently collapse to one. Pass an explicit sessionId only to test
   * that threading behavior.
   */
  seed(input?: PlanInput): Promise<string>;
  /** PUT /api/reviews/:id/draft — autosave the reviewer's working draft
   * (version-scoped annotations and/or the general-comment draft), the same
   * surface the UI's autosave uses. Lets a spec seed annotations harness-side. */
  putDraft(id: string, body: DraftBody): Promise<void>;
  /** GET /api/reviews/:id — status + parsed body (body undefined on 404). */
  getReview(id: string): Promise<{ status: number; body?: ClientReview }>;
  /** GET /api/reviews — the pending list. */
  listReviews(): Promise<ClientReview[]>;
  /** POST /api/reviews/:id/resolve — record a decision (the same surface the UI
   * uses), so a spec can deny a review harness-side and thread a revision onto
   * it with the next seed. */
  resolve(id: string, behavior: "allow" | "deny", feedback?: string): Promise<void>;
  /** POST /api/prefs — the same public route the Settings toggles write through, so a
   * spec can stage a daemon-owned pref (the `updates.check` opt-out) harness-side. */
  setPrefs(patch: PrefsPatch): Promise<void>;
  /** Seed a review with `count` versions under one session: post v1, deny it,
   * then post each revision (which threads onto the rejected review), leaving the
   * review pending at v`count`. Returns the review id.
   *
   * `cwd` defaults to the same throwaway path `seed` uses. Pass a real project
   * dir when the spec needs the plan's references to RESOLVE — that is the only
   * way a spec gets a multi-version review and a working reference in one review. */
  seedVersions(count: number, plans: string[], cwd?: string): Promise<string>;
  /** Push a new version onto an existing review while a page is open: deny the
   * current review (so the daemon appends) and post `plan` onto its session. The
   * open UI sees the new version arrive — the live counterpart to seedVersions,
   * which posts every version before the page loads. */
  addVersion(id: string, plan: string): Promise<void>;
}

/**
 * The suite's own test options, set from `playwright.config.ts`.
 *
 * Playwright's `[default, { option: true }]` fixture form is how a custom
 * fixture's knob reaches the config, which is where every other deadline the
 * suite runs under already lives (doc/agents/browser-testing.md § Timeouts are
 * budgets for the loaded host). The config is the one that binds; the default in
 * `test.extend` below only applies to a run that loads this fixture under some
 * other config.
 */
export interface E2EOptions {
  /**
   * The daemon-boot budget, spent once per phase rather than across both: the
   * stdout port handshake takes it as a real deadline, then the `/health` poll
   * spends it again as `bootTimeoutMs / 50` probes at 50ms. The poll is an
   * attempt count, not a clock — `httpHealth` carries its own 500ms abort, so
   * against a daemon that listens but never answers it runs well past this
   * number and Playwright's per-test `timeout` is what fires.
   */
  bootTimeoutMs: number;
  /**
   * The BUILD verdict the fixture daemon holds — what `runUpdateCheck` would have
   * settled on, before the reviewer's `updates.check` is folded in (EXC-1210). It
   * reaches the daemon as a JSON env var, so a spec that wants a pending update stages
   * it through `test.use({ updateStatus })` rather than stubbing `/api/update` in the
   * page: the opt-out is the daemon's answer now, and a stub would test the stub.
   *
   * Defaults to the honest verdict for a daemon running from source, which is quiet —
   * so no spec meets a toast or a badge it did not ask for.
   */
  updateStatus: UpdateStatus;
}

const DAEMON_ENTRY = fileURLToPath(new URL("./daemon-entry.ts", import.meta.url));

/** Resolve the one `{"port": N}` line daemon-entry.ts prints to stdout. */
function awaitPortLine(
  child: ChildProcess,
  stderr: () => string,
  timeoutMs: number,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      try {
        settle(() => resolve((JSON.parse(buf.slice(0, nl)) as { port: number }).port));
      } catch (err) {
        settle(() =>
          reject(
            new Error(
              `caret e2e daemon: bad port line ${JSON.stringify(buf.slice(0, nl))}: ${err}`,
            ),
          ),
        );
      }
    };
    // "close" (not "exit"): exit can fire before the stdout pipe drains, which
    // would spuriously reject even though the port line was already written.
    const onClose = (code: number | null) => {
      settle(() =>
        reject(
          new Error(`caret e2e daemon exited (code ${code}) before reporting a port\n${stderr()}`),
        ),
      );
    };
    // Without this, a spawn failure (e.g. `bun` missing from PATH) is an
    // unhandled "error" event that tears down the whole runner process.
    const onError = (err: Error) => {
      settle(() => reject(new Error(`caret e2e daemon failed to spawn: ${err.message}`)));
    };
    const timer = setTimeout(() => {
      settle(() =>
        reject(new Error(`caret e2e daemon: no port line within ${timeoutMs}ms\n${stderr()}`)),
      );
    }, timeoutMs);
    // Settle exactly once, then detach everything so late events are inert.
    const settle = (fn: () => void) => {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.off("close", onClose);
      child.off("error", onError);
      fn();
    };
    child.stdout?.on("data", onData);
    child.on("close", onClose);
    child.on("error", onError);
  });
}

// node-runner sleep: the Playwright fixture runs under node, so reach for
// setTimeout rather than Bun.sleep (the src probe defaults to Bun.sleep).
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Run `cmd` and return its trimmed stdout, or "" on any failure — absent,
 * non-zero, or still running at the timeout. execFileSync blocks the node event
 * loop, so the timeout is what keeps a wedged probe from wedging the worker past
 * every Playwright deadline. */
function tryOutput(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim();
  } catch {
    return "";
  }
}

let resolvedRumdl: string | undefined;

/**
 * The pinned rumdl to hand every daemon, resolved once per worker process.
 *
 * ensureRumdl() (src/plan/rumdl.ts) is version-gated against $XDG_STATE_HOME, and
 * every test gets a fresh throwaway one — so without this the first POST
 * /api/reviews of every test downloads the pinned 5.6MB release from GitHub,
 * formats one plan with it, and deletes it at teardown. That is ~1.7GB per suite
 * run on the critical path of every test (EXC-1053), and it also makes the suite
 * depend on github.com being reachable.
 *
 * The bun suite already solves this the same way: test/support/rumdl-preload.ts
 * (EXC-828) sets CARET_RUMDL_BIN from PATH through bunfig.toml's [test] preload.
 * Playwright doesn't read bunfig, so this is that resolution for the node runner
 * — same source (PATH, i.e. the mise-pinned tool), so they resolve the same
 * binary.
 *
 * Loud on purpose. A binary that is missing or reports the wrong version is NOT
 * an error downstream — ensureRumdl just falls back to the download — so failing
 * quietly here would silently restore the whole cost.
 */
function pinnedRumdl(): string {
  if (resolvedRumdl) return resolvedRumdl;
  const bin = process.env.CARET_RUMDL_BIN?.trim() || tryOutput("which", ["rumdl"]);
  const version = bin ? tryOutput(bin, ["--version"]).split(/\s+/).at(-1) : "";
  if (version !== RUMDL_VERSION) {
    throw new Error(
      `caret e2e: no rumdl ${RUMDL_VERSION} to hand the daemon — resolved ${bin || "nothing"}, ` +
        `reporting ${version || "nothing"}. Run \`mise install\` (mise.toml pins it) or set ` +
        "CARET_RUMDL_BIN; without it every test downloads the pinned release into its own " +
        "throwaway state dir.",
    );
  }
  resolvedRumdl = bin;
  return bin;
}

export const test = base.extend<E2EOptions & { daemon: Daemon }>({
  bootTimeoutMs: [15_000, { option: true }],
  updateStatus: [{ kind: "unavailable", reason: "dev" }, { option: true }],
  daemon: async ({ bootTimeoutMs, updateStatus }, use) => {
    // Before mkdtemp so an unresolvable rumdl can't leak a state dir.
    const rumdl = pinnedRumdl();
    // Ephemeral, isolated state: the daemon's reviews/prefs/logs all live under
    // this dir and are wiped at teardown. The user's real state is never touched.
    const stateDir = await mkdtemp(join(tmpdir(), "caret-e2e."));
    // stdin is a live pipe on purpose: the daemon self-reaps when it closes,
    // so a SIGKILL'd runner can't leave an orphan daemon behind.
    const child = spawn("bun", [DAEMON_ENTRY], {
      env: {
        ...process.env,
        XDG_STATE_HOME: stateDir,
        CARET_RUMDL_BIN: rumdl,
        CARET_E2E_UPDATE_STATUS: JSON.stringify(updateStatus),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stderrChunks: Buffer[] = [];
    child.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));
    const stderr = () => Buffer.concat(stderrChunks).toString();

    try {
      const port = await awaitPortLine(child, stderr, bootTimeoutMs);
      const url = `http://127.0.0.1:${port}`;
      // The same budget again, spent as probes rather than as a deadline (see
      // E2EOptions); node-runner sleep.
      await waitForHealth(url, {
        attempts: Math.ceil(bootTimeoutMs / 50),
        intervalMs: 50,
        sleep,
      });

      await use({
        url,
        async seed(input?: PlanInput) {
          const res = await fetch(`${url}/api/reviews`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: randomUUID(),
              cwd: "/tmp/caret-e2e",
              plan: FIXTURE_PLAN,
              ...input,
            }),
          });
          if (!res.ok) throw new Error(`seed failed: POST /api/reviews → ${res.status}`);
          return ((await res.json()) as RouteResult).id;
        },
        async putDraft(id: string, body: DraftBody) {
          const res = await fetch(`${url}/api/reviews/${encodeURIComponent(id)}/draft`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error(`putDraft failed: PUT /draft → ${res.status}`);
        },
        async getReview(id: string) {
          const res = await fetch(`${url}/api/reviews/${encodeURIComponent(id)}`);
          if (!res.ok) return { status: res.status };
          return { status: res.status, body: (await res.json()) as ClientReview };
        },
        async listReviews() {
          const res = await fetch(`${url}/api/reviews`);
          if (!res.ok) throw new Error(`GET /api/reviews → ${res.status}`);
          return (await res.json()) as ClientReview[];
        },
        async resolve(id: string, behavior: "allow" | "deny", feedback?: string) {
          const res = await fetch(`${url}/api/reviews/${encodeURIComponent(id)}/resolve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ behavior, ...(feedback === undefined ? {} : { feedback }) }),
          });
          if (!res.ok) throw new Error(`resolve failed: POST /resolve → ${res.status}`);
        },
        async setPrefs(patch: PrefsPatch) {
          const res = await fetch(`${url}/api/prefs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });
          if (!res.ok) throw new Error(`setPrefs failed: POST /api/prefs → ${res.status}`);
        },
        async seedVersions(count: number, plans: string[], cwd = "/tmp/caret-e2e") {
          // One session threads the revisions: post v1, then for each later
          // version deny the pending review (so the daemon will append) and post
          // the next plan onto the same session. Leaves the review pending at the
          // final version.
          const sessionId = randomUUID();
          let id = "";
          for (let v = 0; v < count; v++) {
            if (v > 0) await this.resolve(id, "deny", "next revision");
            const res = await fetch(`${url}/api/reviews`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId, cwd, plan: plans[v] }),
            });
            if (!res.ok) throw new Error(`seedVersions failed: POST /api/reviews → ${res.status}`);
            id = ((await res.json()) as RouteResult).id;
          }
          return id;
        },
        async addVersion(id: string, plan: string) {
          // Reuse the review's own session so the daemon threads the new plan onto
          // it as a fresh version. Deny first so the pending review is resolved and
          // the next POST appends rather than being deduped.
          const current = await this.getReview(id);
          const sessionId = current.body?.sessionId;
          if (sessionId === undefined) throw new Error(`addVersion: review ${id} has no session`);
          await this.resolve(id, "deny", "next revision");
          const res = await fetch(`${url}/api/reviews`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, cwd: "/tmp/caret-e2e", plan }),
          });
          if (!res.ok) throw new Error(`addVersion failed: POST /api/reviews → ${res.status}`);
        },
      });
    } finally {
      // Reap the daemon before wiping its state dir; escalate if SIGTERM hangs.
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        const killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
        await exited;
        clearTimeout(killTimer);
      }
      await rm(stateDir, { recursive: true, force: true });
    }
  },

  // Route Playwright's built-in baseURL at this test's daemon so specs can
  // `page.goto("/")` and use relative paths.
  baseURL: async ({ daemon }, use) => {
    await use(daemon.url);
  },

  // Wait out the keyboard handover before the first key of each navigation.
  //
  // Wrapping the keyboard rather than exporting a helper for specs to call,
  // because the hazard is invisible at the call site and easy to forget: a
  // dropped key raises nothing, and the spec fails later on whatever the
  // keystroke should have produced. It equally cannot live in `planSurface` —
  // three specs never call it, and `plan-breadcrumbs` is one of them while
  // driving `j`/`k`/Tab throughout.
  //
  // Waiting HERE rather than in `goto` is what keeps it cheap. Nearly every
  // navigation lands on a renderer that is not yet taking keys, but only ten of
  // the fifty specs ever press one, and the rest would pay the whole handover to
  // click and read. Deferring it to the first keystroke moved the suite from
  // 4.9m back to its 2.3m baseline while covering 441 of the 444 key presses in
  // it; the three that go through `locator.press` instead are written as
  // `focus()` + `page.keyboard.press` so they come through here too.
  page: async ({ page }, use) => {
    let ready = false;
    // Any main-frame navigation lands on a renderer whose keyboard has to be
    // re-proven. Sub-frame navigations are irrelevant and must not reset it.
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) ready = false;
    });

    const kb = page.keyboard;
    const raw = {
      press: kb.press.bind(kb),
      type: kb.type.bind(kb),
      down: kb.down.bind(kb),
      up: kb.up.bind(kb),
    };
    const ensure = async () => {
      if (ready) return;
      // The probe presses through `raw.press`; going through the wrapper would
      // recurse into this same check.
      await awaitKeyboardReady(page, raw.press);
      ready = true;
    };

    kb.press = async (key, options) => {
      await ensure();
      return raw.press(key, options);
    };
    kb.type = async (text, options) => {
      await ensure();
      return raw.type(text, options);
    };
    kb.down = async (key) => {
      await ensure();
      return raw.down(key);
    };
    kb.up = async (key) => {
      await ensure();
      return raw.up(key);
    };

    await use(page);
  },
});

/**
 * Resolve once this page's renderer actually receives key events.
 *
 * Playwright gives each test a fresh browser context, but Chromium tears the
 * previous one down asynchronously and the OUTGOING renderer keeps keyboard
 * focus while it does. Key events dispatched into that window reach nothing at
 * all: `window`, `document` and element-level capture listeners all count zero,
 * and so does a raw CDP `Input.dispatchKeyEvent` issued outside Playwright —
 * while `Input.insertText` on the same page still inserts. The page is live and
 * its `activeElement` is correct; only key ROUTING is dead, and it comes back on
 * its own once the previous renderer is gone.
 *
 * What poisons a renderer is a preceding test having focused a CodeMirror
 * editor. Plain navigation never does it — three consecutive loads still type
 * fine. That is also why this looked like flakiness rather than a bug: a spec
 * that never presses a key cannot notice, so the failure lands on whichever
 * key-driven test happens to follow another one in the same worker, and
 * `fullyParallel` reshuffles that with host load. A different unrelated spec
 * goes red on each full-gate run and every one of them passes in isolation.
 * Under `--workers=1` — which `CARET_E2E_WORKERS` exists to allow on a
 * constrained host — it stops being intermittent and fails every run.
 *
 * This runs on the blank page each test opens on, BEFORE the app is loaded,
 * because the condition is a property of the renderer rather than of any
 * document: clearing it up front means no spec has to know the hazard exists.
 * It is a wait, not a remedy — reload, `about:blank`, blurring, unmounting the
 * editor, `bringToFront`, re-enabling focus emulation, the old headless shell
 * and disabling renderer-process reuse were all tried and none of them shortens
 * it; only the outgoing renderer going away does.
 *
 * Probed rather than slept through (browser-testing.md § waiting on a condition,
 * not a clock). `Shift` is the probe because it produces no text and matches
 * none of the chrome's single-key shortcuts, so pressing it against whatever
 * holds focus changes nothing; the poll returns on the first press that lands,
 * which on a healthy renderer is the first attempt.
 *
 * It is still a REAL keydown, which the safe-mode guard would eat like any other
 * if it landed inside that guard's 300ms grace window (`ui/src/lib/safeMode.ts`
 * exempts no key, modifiers included). It does not in practice — a spec has spent
 * well past 300ms loading the plan before it presses anything, which is the same
 * reason `waitPastSafeModeGrace` is needed only by specs that race the window on
 * purpose. `safe-mode.e2e.ts` is the one spec that opens a grace window
 * deliberately, and it warms the keyboard before doing so rather than letting
 * this probe be the keystroke its guard sees.
 */
export async function awaitKeyboardReady(
  page: Page,
  press: (key: string) => Promise<void>,
): Promise<void> {
  // A tight loop rather than `toPass`, whose backoff climbs to a second and more
  // between attempts — far past the handover, which clears in the low hundreds of
  // milliseconds. Each attempt already costs three round trips, so the loop paces
  // itself; the sleep only keeps a wedged renderer from spinning.
  const deadline = Date.now() + 20_000;
  for (;;) {
    await page.evaluate(() => {
      const probe = window as unknown as { __keyProbe: number };
      probe.__keyProbe = 0;
      window.addEventListener(
        "keydown",
        () => {
          probe.__keyProbe += 1;
        },
        { capture: true, once: true },
      );
    });
    await press("Shift");
    const landed = await page.evaluate(
      () => (window as unknown as { __keyProbe: number }).__keyProbe,
    );
    if (landed > 0) return;
    if (Date.now() > deadline) {
      throw new Error(
        "caret e2e: this page never began receiving key events. Every keystroke the " +
          "spec goes on to send would be dropped silently, so the run stops here " +
          "rather than failing later on whatever the typing should have produced.",
      );
    }
    await sleep(25);
  }
}

/** The one field of bits-ui's `DismissibleLayerState` this needs: the layer's own node. */
type BitsLayer = { opts: { ref: { current: Element | null } } };
type BitsLayerRegistry = { bitsDismissableLayers?: Map<BitsLayer, unknown> };

/**
 * Wait until `layer`'s bits-ui dismissible layer has armed its outside-click handler.
 *
 * A layer is not dismissible the moment it is on screen. `DismissibleLayerState` (bits-ui
 * 2.19.0: node_modules/bits-ui/dist/bits/utilities/dismissible-layer/use-dismissable-layer.svelte.js)
 * attaches its document `pointerdown`/`focusin` listeners inside `afterSleep(1, …)` once
 * its `ref` is set — so both `toBeVisible()`, which resolves on paint, and the confirm
 * button taking focus from `onOpenAutoFocus`, which runs on mount, land INSIDE that
 * window. Neither proves a thing about dismissal; waiting on the focus was measured still
 * red 3/40 (EXC-1200).
 *
 * The click is DROPPED rather than delayed, which is why nothing later recovers it, by
 * whichever of two routes the call site has. With a layer beneath — a bubble inside the
 * Request Changes dialog — that one is still top-most, and a pointerdown inside it (the
 * dialog's own heading, say) is not outside anything. With nothing registered beneath —
 * the composer and the annotation card, neither of which is a bits-ui layer — the map is
 * empty and no document listener exists at all, so the pointerdown reaches nobody. Same
 * lost gesture, shorter route.
 *
 * Membership in `globalThis.bitsDismissableLayers` is therefore the arming signal, and an
 * exact one: bits-ui registers the layer there in the same synchronous callback that
 * attaches the listeners. It proves the layer is ARMED, not that it is RESPONSIBLE —
 * `isResponsibleLayer` runs `findLast` over the layers whose behaviour is `close` or
 * `ignore` and falls back to the first when they all defer, which at these call sites
 * lands on the bubble only because it is the last layer opened. The window measured
 * 4–47ms locally, with the layer still unarmed after `toBeVisible()` in 3 runs of 30.
 *
 * Not a product bug: the window is a 1ms `setTimeout` that only host contention stretches
 * this far, and a real reviewer's next click cannot land inside a window their own
 * preceding click opened. It is the driver, arriving in microseconds, that gets there.
 *
 * Call it on the layer's own content element — the node bits-ui binds as `ref`, which for
 * the discard bubble is the `role="alertdialog"` div `discardConfirm()` returns, not a
 * descendant of it — and only once that element is on screen: `expect.poll` evaluates its
 * callback OUTSIDE the try/catch that drives the retry, so an unresolvable locator fails
 * on the first attempt against the per-test budget rather than polling against this one.
 *
 * `expect.poll` so the read inherits the assertion budget rather than the per-test one
 * (doc/agents/browser-testing.md § Timing discipline, the "Polled" bullet).
 */
export async function awaitDismissArmed(layer: Locator): Promise<void> {
  await expect
    .poll(
      () =>
        layer.evaluate((el) => {
          const layers = (globalThis as unknown as BitsLayerRegistry).bitsDismissableLayers;
          return layers !== undefined && [...layers.keys()].some((l) => l.opts.ref.current === el);
        }),
      {
        message:
          "bits-ui never registered this layer in globalThis.bitsDismissableLayers. Either " +
          "the layer never opened, or bits-ui moved the internal this wait reads — re-check " +
          "use-dismissable-layer.svelte.js against the docblock above (read at 2.19.0).",
      },
    )
    .toBe(true);
}

/**
 * Wait until the safe-mode grace window that opened at app mount has passed.
 *
 * The guard (ui/src/lib/safeMode.ts) arms a 300ms grace window when App mounts;
 * a keystroke inside it is deliberately swallowed — that's the feature, and
 * safe-mode.e2e.ts asserts it. Specs whose FIRST key press could otherwise race
 * that window call this after asserting the plan is visible (mount done, so the
 * guard armed at or before the captured instant). Not a wall-clock sleep: the
 * condition reads performance.now(), the same clock the guard reads, so it
 * cannot race hydration speed.
 */
export async function waitPastSafeModeGrace(page: Page): Promise<void> {
  const t0 = await page.evaluate(() => performance.now());
  await page.waitForFunction((t) => performance.now() > t + 350, t0);
}

/**
 * Wait until the review poll has delivered two more list responses.
 *
 * The UI re-fetches GET /api/reviews every 2s (ui/src/state/polling.svelte.ts).
 * Specs asserting a NEGATIVE across that poll — nothing remounted, nothing
 * re-fetched, scroll did not reset — need the poll to have actually ticked twice,
 * which is a network event, not an elapsed duration. Waiting on the responses is
 * both the web-first form and the honest one: a fixed sleep either undershoots a
 * loaded host or overshoots an idle one, and it never says what it is waiting for.
 *
 * Two, not one: one tick could have been in flight when the assertion's setup
 * finished, so the second is the first that provably observed the settled state.
 */
export async function waitForTwoPollTicks(page: Page): Promise<void> {
  let seen = 0;
  await page.waitForResponse(
    (res) => new URL(res.url()).pathname === "/api/reviews" && ++seen >= 2,
  );
}

/**
 * Wait past the delay the app arms before a held key starts repeating (EXC-1122).
 *
 * The honest form of the same shape `waitPastSafeModeGrace` uses, on the same
 * discriminator browser-testing.md § Timing discipline draws: the number is
 * `KEY_REPEAT_DELAY_MS`, imported from the module that holds it, and it is read off
 * `performance.now()` — the clock the app arms it on. A run still going would have
 * ticked several times inside the window, so the wait is what turns "the walk stopped"
 * into a claim rather than a snapshot. A whole delay rather than one interval, so the
 * margin does not depend on the cadence.
 *
 * Here rather than in either spec because the plan's two heading surfaces both hold
 * keys, and a second copy of the justification is how the two drift.
 */
export async function pastKeyRepeatDelay(page: Page): Promise<void> {
  const deadline = (await page.evaluate(() => performance.now())) + KEY_REPEAT_DELAY_MS;
  await page.waitForFunction((until) => performance.now() > until, deadline);
}

/**
 * Poll a held walk until it has been seen on `count` distinct rows.
 *
 * The SET is the assertion, not the row the walk is on: these lists wrap, so the walk
 * is somewhere different by the time any single read lands, while the set only grows.
 * It is also what proves a traversal rather than one move — reaching three distinct
 * rows takes at least two steps past the one the press itself made. `read` returns the
 * row the surface is on, or `""` when it is between rows or on none.
 *
 * Sampled on a fixed short interval rather than Playwright's backing-off default,
 * which climbs to a second between reads and would spend most of the per-test budget
 * watching a walk that is already several rows on.
 */
export async function walkVisits(read: () => Promise<string>, count: number): Promise<void> {
  const seen = new Set<string>();
  await expect
    .poll(
      async () => {
        const row = await read();
        if (row !== "") seen.add(row);
        return seen.size;
      },
      { intervals: [50] },
    )
    .toBeGreaterThanOrEqual(count);
}

/**
 * Resolve a motion token the way the engine does, in seconds — the units both
 * `getComputedStyle` and `AnimationEvent.elapsedTime` report.
 *
 * Asked of the engine through a throwaway probe rather than parsed out of the
 * stylesheet, so a spec asserting a duration asserts against the token the component
 * actually references rather than a number retyped beside it. That is the difference
 * between a retune moving one value in `tokens.css` and a retune hand-editing every
 * spec that ever watched a surface move.
 *
 * Here rather than in `chrome.ts` because it is not a locator — that module's contract
 * is the chrome's locators (browser-testing.md § Locators) — and its callers are not
 * all chrome specs: the preview lane and the composer read tokens too.
 */
export async function motionToken(page: Page, token: string): Promise<number> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.setProperty("animation-duration", `var(${name})`);
    document.body.append(probe);
    const value = getComputedStyle(probe).animationDuration;
    probe.remove();
    return Number.parseFloat(value); // seconds
  }, token);
}

export { expect };
