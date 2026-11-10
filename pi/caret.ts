// caret's pi extension. pi loads this file through jiti on Node, from `package.json`
// `pi.extensions`. It may import only node builtins, pi's host-provided packages, its own
// pi/ modules, and ../opencode/review-bridge.ts — and nothing it reaches may use bun's
// runtime API, since pi runs on Node.

import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { getAgentDir, VERSION } from "@earendil-works/pi-coding-agent";

import {
  isNewer,
  nodeSpawnRunner,
  parseVersionTriple,
  resolveCaretBin,
  type SpawnRunner,
  warmCaret,
} from "../opencode/review-bridge.ts";
import { installPlanning, type PlanningApi } from "./plan.ts";
import { reviewStore } from "./state.ts";
import { type PiTool, reviewTool } from "./tool.ts";

/** Keep equal to src/adapters/pi/host.ts's PI_FLOOR (test/pi/caret.test.ts pins it);
 * pi/ can't import src/. */
export const PI_FLOOR = "1.5.0";

/** The slice of pi's session context caret calls; pinned by test/pi/sdk-conformance.ts. */
export type PiNotifyContext = {
  ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
};

/** The slice of pi's extension API caret calls; pinned by test/pi/sdk-conformance.ts. */
export type PiApi = PlanningApi & {
  registerTool(tool: PiTool): void;
  on(event: "session_start", handler: (event: unknown, ctx: PiNotifyContext) => void): void;
  on(event: "session_shutdown", handler: () => void): void;
};

export interface CaretHost {
  version: string;
  /** This copy's module URL: its identity against other installed copies, and the base
   * `../bin/caret` resolves against. */
  entryUrl: string;
  /** globalThis in production: survives `/reload`, which loads a fresh module instance. */
  holder: Record<symbol, unknown>;
  env: Record<string, string | undefined>;
  run: SpawnRunner;
  /** pi's agent dir; the plans folder sits under it. */
  agentDir: string;
  /** Spawns `caret prewarm` for `bin`; best-effort. */
  warm: (bin: string) => void;
}

const OWNER = Symbol.for("caret.pi.owner");
const NOTIFIED = Symbol.for("caret.pi.notified");

/** Whether `version` parses and is at least PI_FLOOR. */
export function meetsFloor(version: string): boolean {
  return parseVersionTriple(version) !== null && !isNewer(PI_FLOOR, version);
}

/** One caret warning per process, whichever refusal comes first. */
function notifyOnce(pi: PiApi, holder: Record<symbol, unknown>, message: string): void {
  pi.on("session_start", (_event, ctx) => {
    if (holder[NOTIFIED]) return;
    holder[NOTIFIED] = true;
    ctx.ui.notify(message, "warning");
  });
}

/** Registers the review tool and the planning mode unless pi is below PI_FLOOR or another
 * installed copy already owns `Symbol.for("caret.pi.owner")`. The owner is keyed by
 * `entryUrl`, which differs between installed copies and is stable across `/reload`. It
 * is released on `session_shutdown` so a surviving copy takes over after the owner is
 * removed. Either refusal warns once per process. */
export function installCaret(pi: PiApi, host: CaretHost): void {
  const { version, entryUrl, holder, env, run } = host;
  if (!meetsFloor(version)) {
    notifyOnce(
      pi,
      holder,
      `caret needs pi ${PI_FLOOR} or later (this is pi ${version}), so its review tool is off. Update pi to use caret.`,
    );
    return;
  }
  holder[OWNER] ??= entryUrl;
  const owner = holder[OWNER];
  if (owner !== entryUrl) {
    notifyOnce(
      pi,
      holder,
      `caret is loaded twice: the copy at ${fileURLToPath(String(owner))} runs and the copy at ${fileURLToPath(entryUrl)} stays off. Remove one, then run /reload.`,
    );
    return;
  }
  pi.on("session_shutdown", () => {
    if (holder[OWNER] === entryUrl) delete holder[OWNER];
  });
  const bin = resolveCaretBin({ env, importMetaUrl: entryUrl, overrideVar: "CARET_PI_BIN" });
  const store = reviewStore(holder);
  pi.registerTool(reviewTool({ bin, run, store }));
  installPlanning(pi, {
    store,
    plansDir: join(host.agentDir, "plans"),
    warm: () => host.warm(bin),
  });
}

export default function caret(pi: PiApi): void {
  installCaret(pi, {
    version: VERSION,
    entryUrl: import.meta.url,
    holder: globalThis as unknown as Record<symbol, unknown>,
    env: process.env,
    run: nodeSpawnRunner,
    agentDir: getAgentDir(),
    warm: (bin) => warmCaret(bin, "pi"),
  });
}
