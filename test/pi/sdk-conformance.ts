// A type-level test: tsc (hk's TypeScript(Check)) runs it, so it is plain `.ts`, which
// `bun test` never collects. A red row means pi moved — update caret's local slice,
// never loosen the row. Exported only so Biome's unused-symbol rules ignore it.

import type {
  AgentToolResult,
  CustomEntry,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionFactory,
  ExtensionToolContext,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

import type caret from "@piext/caret.ts";
import type { PiApi } from "@piext/caret.ts";
import type { PlanningCommandContext, PlanningContext, PlanningEntry } from "@piext/plan.ts";
import type { PiTheme } from "@piext/render.ts";
import type { PiTool, PiToolContext, PiToolResult, ReviewDetails } from "@piext/tool.ts";

/** Fails to compile unless `From` is assignable to `To`. */
type Fits<From extends To, To> = [From, To];

export type SdkConformance = [
  // What the host passes caret.
  Fits<ExtensionAPI, PiApi>,
  Fits<ExtensionToolContext, PiToolContext>,
  Fits<Theme, PiTheme>,
  Fits<ExtensionContext, PlanningContext>,
  Fits<ExtensionCommandContext, PlanningCommandContext>,
  Fits<CustomEntry, PlanningEntry>,
  // What caret hands the host.
  Fits<PiTool, ToolDefinition<PiTool["parameters"], ReviewDetails>>,
  Fits<PiToolResult, AgentToolResult<ReviewDetails>>,
  Fits<typeof caret, ExtensionFactory>,
];
