// The approve split-button's variants and label derivation. Kept out of the
// component so the label logic (and the safety rule that "auto" never renders
// as a bare "Approve") has a colocated unit test.

import type { AcceptMode } from "@core/types";

export interface ApproveVariant {
  mode: AcceptMode;
  label: string;
  note: string;
}

export const APPROVE_VARIANTS: ApproveVariant[] = [
  { mode: "default", label: "Approve", note: "Approve edits manually" },
  {
    mode: "acceptEdits",
    label: "Approve & accept edits",
    note: "Auto-accept file edits this session",
  },
  {
    mode: "auto",
    label: "Approve & auto mode",
    note: "Full auto mode this session",
  },
];

/** Primary-button label for the remembered mode. "auto" never renders as a bare
 * "Approve"; an unrecognized mode falls back to "Approve" (belt-and-suspenders —
 * the daemon already coerces a missing/corrupt value to a valid token). */
export function approveLabel(mode: AcceptMode): string {
  return APPROVE_VARIANTS.find((v) => v.mode === mode)?.label ?? "Approve";
}
