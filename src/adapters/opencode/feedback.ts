// Maps a core Decision to the flat decision JSON the OpenCode plugin reads on
// `caret review`'s stdout, adding OpenCode's one accept mode to the shared shape:
//
//   approve         -> { behavior: "allow" }
//   approve & build -> { behavior: "allow", acceptMode: "build" }
//   request changes -> { behavior: "deny", feedback: <text> }
//
// The plugin renders an allow into its approval text, switching a v2 session to the
// build agent on `acceptMode: "build"`, and a deny into the tool-result string the
// model revises against (see the opencode/ packaging).

import { BUILD_VARIANT } from "@/adapters/opencode/approve.ts";
import { type FlatDecision, flatDecision } from "@/adapters/wire.ts";

export function toWireDecision(input: FlatDecision): FlatDecision {
  return flatDecision(input, [BUILD_VARIANT.id]);
}
