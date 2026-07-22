// The registry of user-facing settings surfaced in the Settings modal (EXC-837),
// plus the field/control shapes the two-pane shell (EXC-843) renders and the
// draft store (state/settingsDraft.ts) stages. Each staged field wraps an
// existing browser-preference module, so its read/write hit the SAME
// localStorage key the pref already owns (theme, shortcut hints, diff
// style/indicators) — no new keys enter KNOWN_PREF_KEYS and existing users'
// stored values survive.
//
// Panes that show live, non-staged information (Advanced diagnostics,
// Notifications) contribute search-only entries: they appear in settings search
// (EXC-845) but carry no read/write and never contribute dirty state.
//
// The category strings here are the initial grouping; the two-pane shell
// (EXC-843) owns the final sidebar taxonomy and may relabel them.

import { readDiffIndicators, writeDiffIndicators } from "$lib/diffIndicatorsPref.ts";
import { readDiffStyle, writeDiffStyle } from "$lib/diffStylePref.ts";
import type { DiffIndicators, DiffStyle } from "$lib/diffview/types.ts";
import { readShortcutHints, writeShortcutHints } from "$lib/shortcutHintsPref.ts";
import { applyTheme, readThemeId, THEME_IDS, THEMES, type ThemeId } from "$lib/theme.ts";

/** How the two-pane shell (EXC-843) renders a staged field's control. The draft
 * store ignores this — it only stages values; the control kind drives rendering
 * and search. */
export type SettingControl =
  | { kind: "select"; options: readonly { value: string; label: string }[] }
  | { kind: "toggle" };

interface SettingEntryBase {
  /** Stable id, unique across the registry; the draft store keys staged values by it. */
  key: string;
  /** Sidebar category the entry groups under. */
  category: string;
  /** Field label shown beside the control (and searched). */
  label: string;
  /** One-line description under the label (and searched). */
  description: string;
}

/** A setting the reviewer edits: staged into the draft store, committed on Save. */
export interface StagedField<V = unknown> extends SettingEntryBase {
  kind: "staged";
  control: SettingControl;
  /** Current persisted value — also the draft's dirty baseline (staging never
   * persists, so this stays at the pre-edit value until save()). */
  read: () => V;
  /** Persist a value. Called by the draft's save() for each changed field. */
  write: (value: V) => void;
  /** Render a value to a human label for the unsaved-changes confirm (old → new).
   * Defaults to String(). */
  describe?: (value: V) => string;
  /** Fired when a value is staged (including back to baseline) — for live preview
   * without persisting (theme, EXC-753). MUST NOT write. */
  onStage?: (value: V) => void;
  /** Fired for each changed field on discard, with the baseline value — reverts a
   * live preview. MUST NOT write. */
  onRevert?: (value: V) => void;
}

/** A live, read-only entry (Advanced diagnostics, Notifications): searchable but
 * never staged, so it never contributes dirty state. */
export interface SearchOnlyEntry extends SettingEntryBase {
  kind: "search";
}

export type SettingEntry = StagedField | SearchOnlyEntry;

/** Narrow a registry entry to a staged field — used to filter search-only entries
 * out before the draft store ever sees them. */
export const isStagedField = (entry: SettingEntry): entry is StagedField => entry.kind === "staged";

/** Define a staged field with its value type checked, erased to StagedField for
 * the heterogeneous registry. */
export function stagedField<V>(def: Omit<StagedField<V>, "kind">): StagedField {
  return { kind: "staged", ...def } as StagedField;
}

/** Describe a select value as its option label, so the label lives once (in the
 * options) and the confirm preview reuses it. */
const selectDescribe =
  (options: readonly { value: string; label: string }[]) =>
  (value: string): string =>
    options.find((o) => o.value === value)?.label ?? value;

const themeOptions = THEME_IDS.map((id) => ({ value: id, label: THEMES[id].label }));

const diffStyleOptions = [
  { value: "split", label: "Split" },
  { value: "unified", label: "Unified" },
] as const;

const diffIndicatorOptions = [
  { value: "bars", label: "Bars" },
  { value: "classic", label: "Classic +/−" },
  { value: "both", label: "Both" },
] as const;

/** Every setting the Settings modal surfaces. Staged fields commit through their
 * pref module's existing localStorage key; search-only entries (contributed by
 * later panes) never stage. */
export const SETTINGS_REGISTRY: readonly SettingEntry[] = [
  stagedField<ThemeId>({
    key: "theme",
    category: "Appearance",
    label: "Theme",
    description: "Color palette for the whole interface.",
    control: { kind: "select", options: themeOptions },
    read: readThemeId,
    // applyTheme both persists and applies — the commit on Save. The live preview
    // that applies without persisting is wired by EXC-753 via onStage/onRevert.
    write: applyTheme,
    describe: selectDescribe(themeOptions),
  }),
  stagedField<boolean>({
    key: "shortcutHints",
    category: "General",
    label: "Keyboard shortcut hints",
    description: "Show the shortcut-hint affordances around the interface.",
    control: { kind: "toggle" },
    read: readShortcutHints,
    write: writeShortcutHints,
    describe: (on) => (on ? "Shown" : "Hidden"),
  }),
  stagedField<DiffStyle>({
    key: "diffStyle",
    category: "Diff view",
    label: "Layout",
    description: "Side-by-side (split) or stacked (unified) diff layout.",
    control: { kind: "select", options: diffStyleOptions },
    read: readDiffStyle,
    write: writeDiffStyle,
    describe: selectDescribe(diffStyleOptions),
  }),
  stagedField<DiffIndicators>({
    key: "diffIndicators",
    category: "Diff view",
    label: "Change markers",
    description: "Gutter change markers: bars, classic +/− glyphs, or both.",
    control: { kind: "select", options: diffIndicatorOptions },
    read: readDiffIndicators,
    write: writeDiffIndicators,
    describe: selectDescribe(diffIndicatorOptions),
  }),
];
