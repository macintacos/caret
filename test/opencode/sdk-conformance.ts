// A type-level test: tsc (hk's TypeScript(Check)) runs it, so it is plain `.ts`, which
// `bun test` never collects. A red row means the v2 SDK moved — update caret's local
// slice, never loosen the row. Exported only so Biome's unused-symbol rules ignore it.

import type { Plugin } from "@opencode/plugin";
import type { SessionHooks } from "@opencode/plugin/promise/session";
import type { ToolContext as HostToolContext } from "@opencode/plugin/promise/tool";
import type { Plugin as TuiPlugin } from "@opencode/plugin/tui";

import type { ContextEvent, PromptEvent, SetupContext, ToolContext } from "@oc/caret.plugin.v2.ts";
import type caretTui from "@oc/caret.tui.ts";
import type { TuiContext } from "@oc/caret.tui.ts";
import type caret from "@oc/index.ts";

/** Fails to compile unless `From` is assignable to `To`. */
type Fits<From extends To, To> = [From, To];

export type SdkConformance = [
  // What the host passes caret.
  Fits<Plugin.Context, SetupContext>,
  Fits<HostToolContext, ToolContext>,
  Fits<Parameters<TuiPlugin.Definition["setup"]>[0], TuiContext>,
  // session.hook's overloads hide its events from the Context row, so pin each by key.
  Fits<SessionHooks["context"], ContextEvent>,
  Fits<SessionHooks["prompt"], PromptEvent>,
  // What caret hands the host.
  Fits<typeof caret, Plugin.Plugin>,
  Fits<typeof caretTui, TuiPlugin.Definition>,
];
