// Claude's approve-variant vocabulary: the variants the adapter declares for the
// reviewer's approve split-button, and the mapping from a chosen variant id to
// Claude's session `setMode` permission. The plain approve maps to no permission
// change; the two accept variants switch the session into Claude's acceptEdits /
// auto mode. Keeping the declaration and the mapping colocated means the wire
// tokens, button labels, and emitted permissions can't drift apart.

import type { ApproveVariant } from "../../lib/types.ts";

/** The two Claude session modes an approve can switch into. The plain approve
 * (id "default") changes no mode, so it isn't a SetModeName. */
export type SetModeName = "acceptEdits" | "auto";

/**
 * Claude's declared approve variants, in display order. The ids are Claude's
 * session-mode tokens; the labels and descriptions are the reviewer-facing
 * button text the UI renders verbatim from this declaration.
 */
export const APPROVE_VARIANTS: readonly ApproveVariant[] = [
  { id: "default", label: "Approve", description: "Approve edits manually" },
  {
    id: "acceptEdits",
    label: "Approve & accept edits",
    description: "Auto-accept file edits this session",
  },
  {
    id: "auto",
    label: "Approve & auto mode",
    description: "Full auto mode this session",
  },
];

/** Map an approve-variant id to the Claude session mode it switches into, or
 * undefined for a plain approve (and for any unrecognized id — fail-safe: an
 * unknown token never silently changes the session mode). */
export function setModeFor(id: string | undefined): SetModeName | undefined {
  return id === "acceptEdits" || id === "auto" ? id : undefined;
}
