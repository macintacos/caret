// The live appearance (EXC-883). `$lib/appearance.ts` owns the selection POLICY —
// the mode, the two persisted slots, and the pure resolvers over them; this owns
// the RESOLVED ANSWER and the commands that move it, so no caller re-derives
// it. A caller reads `themeId` / `scheme` / `summary` and issues `setMode` /
// `setSlot`; the persist → repaint sequence lives here once instead of being
// reproduced at four call sites.
//
// A repaint runs only when the resolved ThemeId actually changes — uniformly
// across setMode, setSlot, refresh, and the OS-flip watcher. Pinning light while the
// system is already light, or moving the off-scheme slot, would otherwise wipe
// the whole UI between two identical frames. A replaced theme (`reapply`) is the
// other case that repaints: its id stays put while its tokens change.
//
// The one exception is the boot stand-in: a slot whose saved custom theme has not
// registered yet boots on that theme's cached palette instead of its default. The
// theme registering with the same tokens takes over without a wipe; any other move
// of the resolved theme, `setSlot` on the stand-in's slot, `themesUnavailable`, or
// `themesLoaded` replaces it with what the slots resolve to.
//
// A module singleton (the `shortcuts` registry's shape): there is exactly one
// appearance per document — paintTheme writes `document.documentElement`, and the
// persisted truth is origin-scoped localStorage — so a per-mount instance would be
// fiction. `createAppearance` stays exported for isolated unit tests.

import {
  appearanceSummary,
  type CachedTheme,
  clearCachedTheme,
  DEFAULT_SLOT_THEME,
  isStandIn,
  readCachedTheme,
  readSavedSlotId,
  readSlotTheme,
  readThemeMode,
  resolveScheme,
  resolveThemeId,
  type SchemeMediaQuery,
  sameTokens,
  systemPrefersDark,
  type ThemeMode,
  watchSystemScheme,
  writeCachedTheme,
  writeSlotTheme,
  writeThemeMode,
} from "$lib/appearance.ts";
import {
  type CustomThemeId,
  isBuiltinThemeId,
  paintPalette,
  paintTheme,
  type Scheme,
  type ThemeId,
  themeFor,
} from "$lib/theme.ts";
import { type ThemeWipeDeps, withWipe } from "$lib/themeWipe.ts";

/** The live appearance: the resolved reads every surface follows, plus the
 * commands and lifecycle hooks that move them. */
export interface Appearance {
  /** The persisted mode — pinned to a scheme, or following the OS. */
  readonly mode: ThemeMode;
  /** The persisted theme per scheme; the resolved scheme picks one. */
  readonly slots: Record<Scheme, ThemeId>;
  /** The resolved scheme's slot — the palette showing, except while a boot
   * stand-in is up, when this is still the slot's default. */
  readonly themeId: ThemeId;
  /** The scheme actually showing — the mode, or the OS under `system`. */
  readonly scheme: Scheme;
  /** The one-line readout explaining why this palette is the one showing. */
  readonly summary: string;

  /** Pin a scheme, or follow the OS. Persists, then repaints as a wipe. */
  setMode(mode: ThemeMode): void;
  /** Choose a scheme's palette. Persists, then repaints as a wipe — and caches a
   * custom pick's palette for the next boot, or clears the cache for a built-in pick. */
  setSlot(scheme: Scheme, id: ThemeId): void;
  /** Re-seed from storage and paint instantly, with no wipe — boot (which runs
   * after `migrateLegacyTheme` may have rewritten storage behind this instance)
   * and the dev `--fresh` reset, neither of which has a previous frame to wipe
   * from. Paints the showing slot's cached custom palette when its saved theme
   * has not registered yet. */
  boot(): void;
  /** Re-resolve after the theme registry changed, so a saved slot naming a theme
   * that just registered takes effect — repainting as a wipe only if the palette
   * showing moved. */
  refresh(): void;
  /** The daemon's themes could not be read: replaces a boot stand-in with what the
   * slots resolve to, as a wipe, and leaves the cache for the next load. */
  themesUnavailable(): void;
  /** The daemon's served themes have registered: caches each slot's custom palette
   * (clearing the cache of a slot that holds a built-in), then drops any stand-in
   * whose theme never arrived. */
  themesLoaded(): void;
  /** Re-apply a theme just replaced under the same id. A slot holding it whose scheme
   * no longer matches falls back to its default in-session (storage keeps the saved
   * id); a slot at its default whose saved id is this theme takes it back once the
   * scheme matches again. The palette then repaints as a wipe if it is showing, and
   * each slot's cache is rewritten. A no-op when no slot holds the id or takes it back. */
  reapply(id: CustomThemeId): void;
  /** Follow OS appearance flips for as long as the returned disposer is unused.
   * The media query defaults to the live one; a no-op where none is available. */
  watch(media?: SchemeMediaQuery): () => void;
}

/** The effects an instance performs, injectable so a test drives the OS
 * preference and the wipe without a real browser. */
export interface AppearanceDeps {
  /** Probes the OS `prefers-color-scheme: dark` preference — read at
   * construction and re-read on every `boot()`. */
  prefersDark?: () => boolean;
  /** How a repaint runs as a whole-UI wipe. Defaults to probing the real
   * document's View Transitions support and motion preference. */
  wipe?: ThemeWipeDeps;
}

const SCHEMES = ["light", "dark"] as const;

/**
 * Build a live appearance over the persisted mode + slots. Exported for
 * isolated unit tests; the app uses the `appearance` singleton below.
 */
export function createAppearance(deps: AppearanceDeps = {}): Appearance {
  const probe = deps.prefersDark ?? systemPrefersDark;
  const readSlots = () => ({ light: readSlotTheme("light"), dark: readSlotTheme("dark") });
  const live = $state({
    mode: readThemeMode(),
    slots: readSlots(),
    prefersDark: probe(),
  });

  const resolved = () => resolveThemeId(live.mode, live.slots, live.prefersDark);
  const scheme = () => resolveScheme(live.mode, live.prefersDark);
  // ponytail: chrome tokens only, for the scheme showing at boot; syntax colors
  // follow once the theme registers. Cache the whole FileTheme if that gap matters.
  let standIn: CachedTheme | undefined;

  const dropStandIn = (): void => {
    if (standIn === undefined) return;
    standIn = undefined;
    withWipe(() => paintTheme(resolved()), deps.wipe);
  };

  const syncCache = (slot: Scheme): void => {
    const id = live.slots[slot];
    if (isBuiltinThemeId(id)) clearCachedTheme(slot);
    else writeCachedTheme({ id, scheme: slot, tokens: themeFor(id).tokens });
  };

  // Persist and update state first, then repaint — but only when the resolved
  // theme moved, so a change that leaves the same palette showing costs no wipe.
  const commit = (change: () => void): void => {
    const before = resolved();
    change();
    const after = resolved();
    if (after === before) return;
    const shown = standIn;
    standIn = undefined;
    // The cache holds tokens alone, so the markdown styles land here, unwiped.
    if (shown?.id === after && sameTokens(shown.tokens, themeFor(after).tokens)) {
      paintTheme(after);
      return;
    }
    withWipe(() => {
      paintTheme(after);
    }, deps.wipe);
  };

  return {
    get mode() {
      return live.mode;
    },
    get slots() {
      return live.slots;
    },
    get themeId() {
      return resolved();
    },
    get scheme() {
      return scheme();
    },
    get summary() {
      return appearanceSummary(live.mode, scheme(), themeFor(resolved()).label);
    },
    setMode(mode) {
      commit(() => {
        writeThemeMode(mode);
        live.mode = mode;
      });
    },
    setSlot(target, id) {
      commit(() => {
        writeSlotTheme(target, id);
        live.slots[target] = id;
      });
      // Picking the slot's default leaves the resolved id unchanged, so `commit`
      // alone would leave the cached palette up.
      if (standIn?.scheme === target) dropStandIn();
      syncCache(target);
    },
    boot() {
      live.mode = readThemeMode();
      live.slots = readSlots();
      live.prefersDark = probe();
      const showing = scheme();
      const cached = readCachedTheme(showing);
      standIn = isStandIn(cached, readSavedSlotId(showing), live.slots[showing])
        ? cached
        : undefined;
      if (standIn) paintPalette(standIn);
      else paintTheme(resolved());
    },
    refresh() {
      // Only a slot showing its default can hold a saved id that was unknown until
      // now; any other slot is the in-session pick, which storage may have failed to keep.
      commit(() => {
        for (const slot of SCHEMES) {
          if (live.slots[slot] === DEFAULT_SLOT_THEME[slot]) live.slots[slot] = readSlotTheme(slot);
        }
      });
    },
    themesUnavailable: dropStandIn,
    themesLoaded() {
      for (const slot of SCHEMES) syncCache(slot);
      dropStandIn();
    },
    reapply(id) {
      const touched = SCHEMES.filter(
        (slot) =>
          live.slots[slot] === id ||
          (live.slots[slot] === DEFAULT_SLOT_THEME[slot] && readSlotTheme(slot) === id),
      );
      if (touched.length === 0) return;
      const { scheme } = themeFor(id);
      const showing = resolved() === id;
      commit(() => {
        for (const slot of touched)
          live.slots[slot] = scheme === slot ? id : DEFAULT_SLOT_THEME[slot];
      });
      if (showing && resolved() === id) withWipe(() => paintTheme(id), deps.wipe);
      for (const slot of SCHEMES) syncCache(slot);
    },
    watch(media) {
      return watchSystemScheme((prefersDark) => {
        commit(() => {
          live.prefersDark = prefersDark;
        });
      }, media);
    },
  };
}

/** The app-wide live appearance. Every surface that shows or changes the palette
 * reads this instance — main.ts boots it, App.svelte watches the OS through it,
 * the settings registry commands it, and ThemeSection / FilePreview read it. */
export const appearance = createAppearance();
