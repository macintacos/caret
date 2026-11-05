// OpenCode's approve-variant vocabulary. v1 offers a single plain approve; a v2 plugin
// also declares `build`, which approves and then switches the session from the `plan`
// agent to `build`.

import type { ApproveVariant } from "@/lib/types.ts";

/**
 * The plain approve every OpenCode review offers. The label/description are the
 * reviewer-facing button text the UI renders verbatim.
 */
export const APPROVE_VARIANTS: readonly ApproveVariant[] = [
  { id: "default", label: "Approve", description: "Approve this plan" },
];

/** v2 only: approve, then switch the session to OpenCode's `build` agent. Its id must
 * equal APPROVE_AND_BUILD in opencode/caret.plugin.v2.ts. */
export const BUILD_VARIANT: ApproveVariant = {
  id: "build",
  label: "Approve & build",
  description: "Approve and switch this session to the build agent",
};

/** The variants a review offers when its plugin declared `declared` (the envelope's
 * `approve_variants`): the plain approve plus each variant it named that this adapter
 * knows. Undefined when it declared none, so `caret review` stamps APPROVE_VARIANTS. */
export function declaredApproveVariants(declared: unknown): ApproveVariant[] | undefined {
  if (!Array.isArray(declared) || !declared.includes(BUILD_VARIANT.id)) return undefined;
  return [...APPROVE_VARIANTS, BUILD_VARIANT];
}
