// The shadcn-svelte `cn()` helper: merge a list of conditional class values
// (clsx) and resolve conflicting Tailwind utilities so the last one wins
// (tailwind-merge). Every copied shadcn component imports this from `$lib/utils`
// (see components.json aliases). This is the canonical shadcn form — kept as-is
// so future `shadcn-svelte add` runs don't diff against a bespoke variant.
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
