// The shadcn-svelte `cn()` helper plus the prop-shaping type utilities its
// components import from `$lib/utils` (WithElementRef, WithoutChildrenOrChild).
// `cn` merges conditional class values (clsx) and resolves conflicting Tailwind
// utilities so the last one wins (tailwind-merge). shadcn-svelte's `add` assumes
// this file already exists — only `init` scaffolds it, and we hand-author (init
// would clobber app.css), so the helpers live here verbatim in intent. The
// upstream detection types use `any` in their `extends` guard; `unknown` is
// equivalent for these optional-prop checks and keeps the file inside Biome's
// lint scope (our `cn`, unlike the copied components, stays policed).
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, "child"> : T;
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
