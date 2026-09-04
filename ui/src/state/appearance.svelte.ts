// The live appearance (EXC-883). `$lib/appearance.ts` owns the selection POLICY —
// the mode, the two persisted slots, and the pure resolvers over them; this owns
// the RESOLVED ANSWER and the two commands that move it, so no caller re-derives
// it. A caller reads `themeId` / `scheme` / `summary` and issues `setMode` /
// `setSlot`; the persist → repaint sequence lives here once instead of being
// reproduced at four call sites.
//
// A repaint runs only when the resolved ThemeId actually changes — uniformly
// across setMode, setSlot, and the OS-flip watcher. Pinning light while the
// system is already light, or moving the off-scheme slot, would otherwise wipe
// the whole UI between two identical frames.
//
// A module singleton (the `shortcuts` registry's shape): there is exactly one
// appearance per document — paintTheme writes `document.documentElement`, and the
// persisted truth is origin-scoped localStorage — so a per-mount instance would be
// fiction. `createAppearance` stays exported for isolated unit tests.

import {
  appearanceSummary,
  readSlotTheme,
  readThemeMode,
  resolveScheme,
  resolveThemeId,
  type SchemeMediaQuery,
  systemPrefersDark,
  type ThemeMode,
  watchSystemScheme,
  writeSlotTheme,
  writeThemeMode,
} from "$lib/appearance.ts";
import { paintTheme, type Scheme, THEMES, type ThemeId } from "$lib/theme.ts";
import { type ThemeWipeDeps, withWipe } from "$lib/themeWipe.ts";

/** The live appearance: the resolved reads every surface follows, plus the
 * commands and lifecycle hooks that move them. */
export interface Appearance {
  /** The persisted mode — pinned to a scheme, or following the OS. */
  readonly mode: ThemeMode;
  /** The persisted theme per scheme; the resolved scheme picks one. */
  readonly slots: Record<Scheme, ThemeId>;
  /** The palette actually showing: the resolved scheme's slot. */
  readonly themeId: ThemeId;
  /** The scheme actually showing — the mode, or the OS under `system`. */
  readonly scheme: Scheme;
  /** The one-line readout explaining why this palette is the one showing. */
  readonly summary: string;

  /** Pin a scheme, or follow the OS. Persists, then repaints as a wipe. */
  setMode(mode: ThemeMode): void;
  /** Choose a scheme's palette. Persists, then repaints as a wipe. */
  setSlot(scheme: Scheme, id: ThemeId): void;
  /** Re-seed from storage and paint instantly, with no wipe — boot (which runs
   * after `migrateLegacyTheme` may have rewritten storage behind this instance)
   * and the dev `--fresh` reset, neither of which has a previous frame to wipe
   * from. */
  boot(): void;
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

/**
 * Build a live appearance over the persisted mode + slots. Exported for
 * isolated unit tests; the app uses the `appearance` singleton below.
 */
export function createAppearance(deps: AppearanceDeps = {}): Appearance {
  const probe = deps.prefersDark ?? systemPrefersDark;
  const live = $state({
    mode: readThemeMode(),
    slots: { light: readSlotTheme("light"), dark: readSlotTheme("dark") },
    prefersDark: probe(),
  });

  const resolved = () => resolveThemeId(live.mode, live.slots, live.prefersDark);
  const scheme = () => resolveScheme(live.mode, live.prefersDark);

  // Persist and update state first, then repaint — but only when the resolved
  // theme moved, so a change that leaves the same palette showing costs no wipe.
  const commit = (change: () => void): void => {
    const before = resolved();
    change();
    const after = resolved();
    if (after === before) return;
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
      return appearanceSummary(live.mode, scheme(), THEMES[resolved()].label);
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
    },
    boot() {
      live.mode = readThemeMode();
      live.slots = { light: readSlotTheme("light"), dark: readSlotTheme("dark") };
      live.prefersDark = probe();
      paintTheme(resolved());
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
