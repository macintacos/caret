import type { Plugin } from "@opencode/plugin";
import type { ToolContext as HostToolContext } from "@opencode/plugin/promise/tool";
import type { Plugin as TuiPlugin } from "@opencode/plugin/tui";

import type { SetupContext, ToolContext } from "@oc/caret.plugin.v2.ts";
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
  // What caret hands the host.
  Fits<typeof caret, Plugin.Plugin>,
  Fits<typeof caretTui, TuiPlugin.Definition>,
];
