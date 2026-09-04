// Version-compare state for the source-view surface: the selected version pair,
// whether compare mode is active, the diff layout and the gutter indicators.
//
// It never reads annotations, because the diff SURFACE is annotation-free by
// contract — no gutter, no inline cards. Comments on the compared versions surface
// in the docked comment panel instead (EXC-872, EXC-1041).

import type { PlanVersion } from "@core/lib/types";
import type { DiffIndicators, DiffStyle } from "$lib/diffview/types.ts";
import type { SoundEvent } from "$lib/sound.ts";

/** Reactive fields the host component owns and the factory mutates. Base defaults
 * to the current version and target to the previous one, so the default pair reads
 * as the changes that produced the current version. */
export interface CompareStore {
  /** Whether the reviewer is in compare mode (vs. the single-version view). */
  comparing: boolean;
  /** 1-based reference version (the diff's "after" side). */
  baseVersion: number;
  /** 1-based version compared against (the diff's "before" side). */
  targetVersion: number;
  /** Diff layout: split (side-by-side) or unified (stacked). */
  diffStyle: DiffStyle;
  /** Gutter change markers: bars (vertical) or classic (+/- glyphs). */
  diffIndicators: DiffIndicators;
}

export interface CompareDeps {
  /** Read the persisted layout preference (defaults to "split"). */
  readPref: () => DiffStyle;
  /** Persist the chosen layout preference. */
  writePref: (style: DiffStyle) => void;
  /** Read the persisted gutter-indicators preference (defaults to "bars"). */
  readIndicatorsPref: () => DiffIndicators;
  /** Persist the chosen gutter-indicators preference. */
  writeIndicatorsPref: (indicators: DiffIndicators) => void;
  /** Play a moment's cue. Optional so a test drives the factory silently. */
  sound?: (event: SoundEvent) => void;
}

export interface Compare {
  /** True when there are at least two versions to compare. */
  canCompare(versions: PlanVersion[]): boolean;
  /** The plan text of a given 1-based version number (empty string if absent). */
  planFor(versions: PlanVersion[], version: number): string;
  /** Seed the default pair (base = current, target = previous) and load the
   * persisted layout and gutter indicators. Call when the active review is first
   * established. */
  init(versions: PlanVersion[]): void;
  /** Reconcile the selected pair against a (possibly new) version set: keep the
   * pair if both ends still exist, otherwise reset to the default pair; leave
   * compare mode if fewer than two versions remain. */
  syncVersions(versions: PlanVersion[]): void;
  setBase(version: number): void;
  setTarget(version: number): void;
  setComparing(comparing: boolean): void;
  setDiffStyle(style: DiffStyle): void;
  setDiffIndicators(indicators: DiffIndicators): void;
}

/** The default pair: base = current (last), target = the one before it. A
 * single-version set points both at it. */
function defaultPair(versions: PlanVersion[]): { base: number; target: number } {
  const current = versions[versions.length - 1]?.version ?? 0;
  const previous = versions[versions.length - 2]?.version ?? current;
  return { base: current, target: previous };
}

export function createCompare(store: CompareStore, deps: CompareDeps): Compare {
  function applyDefaultPair(versions: PlanVersion[]): void {
    const { base, target } = defaultPair(versions);
    store.baseVersion = base;
    store.targetVersion = target;
  }

  return {
    canCompare(versions) {
      return versions.length >= 2;
    },

    planFor(versions, version) {
      return versions.find((v) => v.version === version)?.plan ?? "";
    },

    init(versions) {
      store.diffStyle = deps.readPref();
      store.diffIndicators = deps.readIndicatorsPref();
      applyDefaultPair(versions);
    },

    syncVersions(versions) {
      if (versions.length < 2) {
        store.comparing = false;
      }
      const has = (v: number) => versions.some((pv) => pv.version === v);
      if (!has(store.baseVersion) || !has(store.targetVersion)) {
        applyDefaultPair(versions);
      }
    },

    setBase(version) {
      store.baseVersion = version;
    },

    setTarget(version) {
      store.targetVersion = version;
    },

    setComparing(comparing) {
      // Sound the flip only — a re-assert of the flag already held is not a toggle.
      if (comparing !== store.comparing) deps.sound?.("compareToggled");
      store.comparing = comparing;
    },

    setDiffStyle(style) {
      store.diffStyle = style;
      deps.writePref(style);
    },

    setDiffIndicators(indicators) {
      store.diffIndicators = indicators;
      deps.writeIndicatorsPref(indicators);
    },
  };
}
