// The approve split-button's variants and label derivation. The variant set is
// adapter-declared and reaches the UI over the wire (the daemon's /api/health
// `approveVariants`).

import type { ApproveVariant, ApproveVariantId } from "@core/lib/types";

export type { ApproveVariant, ApproveVariantId };

/** The variants rendered when the daemon predates the /api/health
 * `approveVariants` field — the one place the UI carries the agent tool's variant
 * ids itself. A current daemon's live set supersedes these. */
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

/** Pick the variant set to render. An omitted *or empty* declared list falls back,
 * so the user never faces an empty menu. */
export function approveVariants(declared: ApproveVariant[] | undefined): ApproveVariant[] {
  return declared && declared.length > 0 ? declared : WIRE_FALLBACK;
}

/** Primary-button label for the remembered variant id, looked up in the given set.
 * An id the set no longer carries falls back to the first variant's label. */
export function approveLabel(id: ApproveVariantId, variants: ApproveVariant[]): string {
  return variants.find((v) => v.id === id)?.label ?? variants[0]?.label ?? "Approve";
}
