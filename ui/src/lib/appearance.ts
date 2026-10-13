// Which palette is live (EXC-773). theme.ts owns the palette registry; this owns
// the selection policy over them: a MODE — `light`, `dark`, or `system` (the
// default, following the OS) — plus one persisted theme SLOT per scheme, so a
// reviewer can run a light palette by day and a dark one at night without
// re-picking. Resolution is `mode + the OS preference -> scheme -> that scheme's
// slot -> a ThemeId`, which theme.ts then paints.
//
// This module is the pure, one-piece-at-a-time seam: the resolvers take the OS
// preference as an argument and the persisted reads/writes each touch a single
// key, so all of it is unit-testable with no matchMedia and no paint. Nothing
// here holds the resolved answer or repaints — @/state/appearance.svelte.ts owns
// the live appearance, and it is the surface callers use (EXC-883).
//
// It also keeps a per-slot cache of the selected custom theme's built palette, so
// the boot paint can show it before the daemon's themes have registered.

import { definePref, registerPrefKey } from "$lib/definePref.ts";
import {
  type BuiltinThemeId,
  type RuntimeTheme,
  type Scheme,
  THEMES,
  type ThemeId,
  themesForScheme,
} from "$lib/theme.ts";

/** When each scheme applies: pinned to one, or following the OS. */
export type ThemeMode = "light" | "dark" | "system";

/** The modes in display order — the segmented control's options and the
 * persisted-preference allow-list. */
export const THEME_MODES: readonly ThemeMode[] = ["light", "dark", "system"];

export const DEFAULT_MODE: ThemeMode = "system";

/** Each slot defaults to the caret palette of its own scheme. */
export const DEFAULT_SLOT_THEME: Record<Scheme, BuiltinThemeId> = {
  light: "caret-light",
  dark: "caret-dark",
};

/** localStorage keys. Browser-origin-scoped, so the choice survives daemon
 * restarts (the EXC-730 requirement) with no daemon-side state. */
export const MODE_KEY = "caret.theme.mode";
export const LIGHT_SLOT_KEY = "caret.theme.light";
export const DARK_SLOT_KEY = "caret.theme.dark";

/** Each slot's cached custom palette. */
export const LIGHT_CACHE_KEY = "caret.theme.cache.light";
export const DARK_CACHE_KEY = "caret.theme.cache.dark";
registerPrefKey(LIGHT_CACHE_KEY);
registerPrefKey(DARK_CACHE_KEY);

/** The pre-mode key, holding a single ThemeId. Only `migrateLegacyTheme` reads
 * it, and it erases the key on the way through — but it stays registered so the
 * dev `--fresh` reset still clears it for anyone who hasn't migrated yet. */
export const LEGACY_THEME_KEY = "caret.theme";
registerPrefKey(LEGACY_THEME_KEY);

const modePref = definePref<ThemeMode>(MODE_KEY, THEME_MODES, DEFAULT_MODE);

// Each slot's allow-list is its OWN scheme's ids, so a hand-edited wrong-scheme
// value degrades to the slot's default rather than painting a dark palette while
// the resolved scheme (and `data-theme`) say light. It is read live, so a saved id
// resolves once its theme registers.
const slotPrefs: Record<Scheme, ReturnType<typeof definePref<ThemeId>>> = {
  light: definePref<ThemeId>(
    LIGHT_SLOT_KEY,
    () => themesForScheme("light").map((t) => t.id),
    DEFAULT_SLOT_THEME.light,
  ),
  dark: definePref<ThemeId>(
    DARK_SLOT_KEY,
    () => themesForScheme("dark").map((t) => t.id),
    DEFAULT_SLOT_THEME.dark,
  ),
};

// ----- Pure resolution -------------------------------------------------------

/** Which scheme a mode resolves to. A manual mode ignores the OS entirely. */
export function resolveScheme(mode: ThemeMode, prefersDark: boolean): Scheme {
  if (mode !== "system") return mode;
  return prefersDark ? "dark" : "light";
}

/** The live theme id: the resolved scheme's slot. */
export function resolveThemeId(
  mode: ThemeMode,
  slots: Record<Scheme, ThemeId>,
  prefersDark: boolean,
): ThemeId {
  return slots[resolveScheme(mode, prefersDark)];
}

/** The one-line readout under the two theme rows, explaining why the live
 * palette is the one showing. */
export function appearanceSummary(mode: ThemeMode, scheme: Scheme, label: string): string {
  return mode === "system"
    ? `Following your system, which is ${scheme} right now — so ${label} is showing.`
    : `Always ${scheme} — ${label} is showing.`;
}

// ----- Persisted state -------------------------------------------------------

/** Read the remembered mode, defaulting to `system` on a missing, unrecognized,
 * or unreadable value. */
export const readThemeMode = modePref.read;

/** Persist the mode. Painting is the live appearance's next step. */
export const writeThemeMode = modePref.write;

/** Read a scheme's remembered theme, defaulting to that scheme's caret palette. */
export function readSlotTheme(scheme: Scheme): ThemeId {
  return slotPrefs[scheme].read();
}

/** Persist a scheme's theme. Painting is the live appearance's next step. */
export function writeSlotTheme(scheme: Scheme, id: ThemeId): void {
  slotPrefs[scheme].write(id);
}

/** A slot's custom theme as boot paints it before the daemon's themes arrive. */
export type CachedTheme = { id: string } & Pick<RuntimeTheme, "scheme" | "tokens">;

const SLOT_KEYS: Record<Scheme, string> = { light: LIGHT_SLOT_KEY, dark: DARK_SLOT_KEY };
const CACHE_KEYS: Record<Scheme, string> = { light: LIGHT_CACHE_KEY, dark: DARK_CACHE_KEY };
// Every palette carries exactly the `ColorToken` set (theme.test.ts pins it);
// caret-dark stands for all.
const TOKEN_NAMES = Object.keys(THEMES["caret-dark"].tokens).sort().join();

/** Read a slot's cached palette. The blob is hand-editable and may come from an
 * older build, so anything short of a full, well-typed palette for this slot reads
 * as nothing. */
export function readCachedTheme(scheme: Scheme): CachedTheme | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEYS[scheme]);
    if (raw === null) return undefined;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return undefined;
    const { id, scheme: stored, tokens } = value as Record<string, unknown>;
    if (typeof id !== "string" || stored !== scheme) return undefined;
    if (typeof tokens !== "object" || tokens === null) return undefined;
    if (Object.keys(tokens).sort().join() !== TOKEN_NAMES) return undefined;
    if (!Object.values(tokens).every((v) => typeof v === "string")) return undefined;
    return { id, scheme, tokens: tokens as CachedTheme["tokens"] };
  } catch {
    return undefined;
  }
}

/** Cache a palette under its own scheme's slot. */
export function writeCachedTheme(theme: CachedTheme): void {
  try {
    const { id, scheme, tokens } = theme;
    localStorage.setItem(CACHE_KEYS[scheme], JSON.stringify({ id, scheme, tokens }));
  } catch {
    // Storage unavailable — the next load paints the slot's default until it registers.
  }
}

/** Forget a slot's cached palette. */
export function clearCachedTheme(scheme: Scheme): void {
  try {
    localStorage.removeItem(CACHE_KEYS[scheme]);
  } catch {
    // Storage unavailable — a stale entry is ignored unless it names the saved id.
  }
}

/** The slot's stored id as written, registered or not; null when unset or unreadable. */
export function readSavedSlotId(scheme: Scheme): string | null {
  try {
    return localStorage.getItem(SLOT_KEYS[scheme]);
  } catch {
    return null;
  }
}

// ----- Effects ---------------------------------------------------------------

/** A minimal view of the `(prefers-color-scheme: dark)` MediaQueryList — enough
 * to probe and subscribe, so tests can supply a fake. */
export interface SchemeMediaQuery {
  matches: boolean;
  addEventListener(type: "change", listener: (event: { matches: boolean }) => void): void;
  removeEventListener(type: "change", listener: (event: { matches: boolean }) => void): void;
}

/** The live `(prefers-color-scheme: dark)` query, or undefined where matchMedia
 * is unavailable (bun-test without a DOM shim, an ancient browser). */
export function schemeMediaQuery(): SchemeMediaQuery | undefined {
  if (typeof matchMedia !== "function") return undefined;
  return matchMedia("(prefers-color-scheme: dark)");
}

/** Whether the OS currently asks for dark. False when it can't be probed —
 * caret's own default slot then decides, rather than a throw. */
export function systemPrefersDark(): boolean {
  return schemeMediaQuery()?.matches ?? false;
}

/** Subscribe to OS appearance flips. The callback receives the new preference;
 * the returned disposer detaches. A no-op (with a no-op disposer) where no media
 * query is available. */
export function watchSystemScheme(
  onChange: (prefersDark: boolean) => void,
  media: SchemeMediaQuery | undefined = schemeMediaQuery(),
): () => void {
  if (!media) return () => {};
  const listener = (event: { matches: boolean }) => onChange(event.matches);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

/** Adopt a pre-mode single-theme pick as an explicit mode plus its slot, so an
 * existing user's deliberate choice isn't silently replaced by the new `system`
 * default. Runs once at boot and erases the legacy key, so it never re-runs; a
 * user already on the mode model, or one who never picked, is untouched. */
export function migrateLegacyTheme(): void {
  try {
    if (localStorage.getItem(MODE_KEY) !== null) return;
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === null) return;
    localStorage.removeItem(LEGACY_THEME_KEY);
    // An unrecognized value carries no intent to preserve — the removal above is
    // the whole migration for it.
    const adopted = [...themesForScheme("light"), ...themesForScheme("dark")].find(
      (theme) => theme.id === legacy,
    );
    if (!adopted) return;
    writeThemeMode(adopted.scheme);
    writeSlotTheme(adopted.scheme, adopted.id);
  } catch {
    // Storage unavailable (private mode, quota, disabled) — nothing to migrate.
  }
}
