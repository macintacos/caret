// caret's pi extension. pi loads this file through jiti on Node, from `package.json`
// `pi.extensions`. It may import only node builtins, pi's host-provided packages, its own
// pi/ modules, and ../opencode/review-bridge.ts — and nothing it reaches may use bun's
// runtime API, since pi runs on Node.

import { fileURLToPath } from "node:url";

import { VERSION } from "@earendil-works/pi-coding-agent";

import { nodeSpawnRunner, resolveCaretBin, type SpawnRunner } from "../opencode/review-bridge.ts";
import { reviewStore } from "./state.ts";
import { type PiTool, reviewTool } from "./tool.ts";

/** Keep equal to src/adapters/pi/host.ts's PI_FLOOR (test/pi/caret.test.ts pins it); pi/ can't import src/. */
export const PI_FLOOR = "1.5.0";

export type PiNotifyContext = {
  ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
};

export type PiApi = {
  registerTool(tool: PiTool): void;
  on(event: "session_start", handler: (event: unknown, ctx: PiNotifyContext) => void): void;
  on(event: "session_shutdown", handler: () => void): void;
};

export interface CaretHost {
  version: string;
  entryUrl: string;
  /** globalThis in production: survives `/reload`, which loads a fresh module instance. */
  holder: Record<symbol, unknown>;
  env: Record<string, string | undefined>;
  run: SpawnRunner;
}

const OWNER = Symbol.for("caret.pi.owner");
const NOTIFIED = Symbol.for("caret.pi.notified");

function parse(version: string): number[] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.split("-")[0] ?? "");
  return match?.slice(1).map(Number);
}

/** Whether `version` (major.minor.patch, any prerelease suffix ignored) is at least PI_FLOOR. */
export function meetsFloor(version: string): boolean {
  const have = parse(version);
  const floor = parse(PI_FLOOR);
  if (!have || !floor) return false;
  for (let i = 0; i < 3; i++) {
    if (have[i] !== floor[i]) return (have[i] ?? 0) > (floor[i] ?? 0);
  }
  return true;
}

function notifyOnce(pi: PiApi, holder: Record<symbol, unknown>, message: string): void {
  pi.on("session_start", (_event, ctx) => {
    if (holder[NOTIFIED]) return;
    holder[NOTIFIED] = true;
    ctx.ui.notify(message, "warning");
  });
}

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
  pi.registerTool(
    reviewTool({
      bin: resolveCaretBin({ env, importMetaUrl: entryUrl, overrideVar: "CARET_PI_BIN" }),
      run,
      store: reviewStore(holder),
    }),
  );
}

export default function caret(pi: PiApi): void {
  installCaret(pi, {
    version: VERSION,
    entryUrl: import.meta.url,
    holder: globalThis as unknown as Record<symbol, unknown>,
    env: process.env,
    run: nodeSpawnRunner,
  });
}
