// The approve split-button's variants and label derivation. The variant set is
// adapter-declared and reaches the UI over the wire (the daemon's /api/health
// `approveVariants`); this module only picks the variants to render and derives
// the primary button's label, with a colocated unit test for the label logic.

import type { ApproveVariant, ApproveVariantId } from "@core/lib/types";

export type { ApproveVariant, ApproveVariantId };

/** The built-in approve variants the UI renders when the daemon predates the
 * /api/health `approveVariants` field (an older daemon behind the port). This is
 * the one place the UI carries the agent tool's variant ids; a current daemon
 * supplies the live set, which supersedes these. */
export const WIRE_FALLBACK: ApproveVariant[] = [
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

/** Pick the variant set to render: the daemon's declared list when present and
 * non-empty, else the built-in fallback. A daemon that omits the field — or
 * sends an empty list — leaves the user with the three known options rather than
 * an empty menu. */
export function approveVariants(declared: ApproveVariant[] | undefined): ApproveVariant[] {
  return declared && declared.length > 0 ? declared : WIRE_FALLBACK;
}

/** Primary-button label for the remembered variant id, looked up in the given
 * set. An unrecognized id falls back to the first variant's label (the plain
 * approve), so a non-edit variant never renders as a bare default and a stale
 * remembered id still produces a sensible label. */
export function approveLabel(id: ApproveVariantId, variants: ApproveVariant[]): string {
  return variants.find((v) => v.id === id)?.label ?? variants[0]?.label ?? "Approve";
}
