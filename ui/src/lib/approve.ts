// The approve split-button's variants and label derivation. Each review declares
// its variant set, and it reaches the UI on the review (`approveVariants`).

import type { ApproveVariant, ApproveVariantId } from "@core/lib/types";

export type { ApproveVariant, ApproveVariantId };

/** The variants rendered for a review that declares none — one from an older caret,
 * or a dev/e2e seed. The one place the UI carries the agent tool's variant ids
 * itself; a review's declared set supersedes these. */
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

/** The variant id to drive the primary Approve button: what this browser remembered,
 * gated against the live set so an id from another adapter (or an older caret) can
 * never resolve to a variant this review does not declare. */
export function pickApproveMode(
  remembered: ApproveVariantId | null,
  variants: ApproveVariant[],
): ApproveVariantId {
  if (remembered !== null && variants.some((v) => v.id === remembered)) return remembered;
  return variants[0]?.id ?? "default";
}
