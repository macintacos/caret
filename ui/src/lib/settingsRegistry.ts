// The registry of user-facing settings surfaced in the Settings modal (EXC-837),
// plus the field/control shapes the two-pane shell (EXC-843) renders. Each field
// wraps an existing browser-preference module, so its read/write hit the SAME
// localStorage key the pref already owns (theme, shortcut hints, diff
// style/indicators) — no new keys enter KNOWN_PREF_KEYS and existing users'
// stored values survive. Editing a setting applies it immediately: the shell
// calls write() the moment a control changes (App confirms with a toast); there
// is no staged draft.
//
// Panes that show live, read-only information (Advanced diagnostics,
// Notifications) contribute search-only entries: they appear in settings search
// (EXC-845) but carry no read/write.
//
// `category` is the sidebar taxonomy (one nav row each); `section` sub-groups a
// category's fields into labelled blocks within its pane (Diff view lives as a
// section under Appearance).

import { readDiffIndicators, writeDiffIndicators } from "$lib/diffIndicatorsPref.ts";
import { readDiffStyle, writeDiffStyle } from "$lib/diffStylePref.ts";
import type { DiffIndicators, DiffStyle } from "$lib/diffview/types.ts";
import { readShortcutHints, writeShortcutHints } from "$lib/shortcutHintsPref.ts";
import { applyTheme, readThemeId, THEME_IDS, THEMES, type ThemeId } from "$lib/theme.ts";

/** One choice in a select control. `swatch` is an optional row of CSS colors rendered
 * as small dots beside the label — the theme options preview their palette this way. */
export interface SettingOption {
  value: string;
  label: string;
  swatch?: readonly string[];
}

/** How the two-pane shell (EXC-843) renders a field's control: the kind drives
 * both the rendered control and search. */
export type SettingControl =
  | { kind: "select"; options: readonly SettingOption[] }
  | { kind: "toggle" };

interface SettingEntryBase {
  /** Stable id, unique across the registry; a field's control keys off it. */
  key: string;
  /** Sidebar category the entry groups under (one nav row per category). */
  category: string;
  /** Optional sub-group within the category's pane, rendered as a labelled block
   * (e.g. "Diff view" under Appearance). Fields with no section render first. */
  section?: string;
  /** Field label shown beside the control (and searched). */
  label: string;
  /** One-line description under the label (and searched). */
  description: string;
}

/** A setting the reviewer edits: its control applies immediately via write(). */
export interface StagedField<V = unknown> extends SettingEntryBase {
  kind: "staged";
  control: SettingControl;
  /** Current persisted value — the control's displayed value. */
  read: () => V;
  /** Persist and apply a value, the moment the control changes. May throw to
   * signal a save failure (App surfaces a persistent error toast). */
  write: (value: V) => void;
}

/** A live, read-only entry (Advanced diagnostics, Notifications): searchable but
 * never edited. */
export interface SearchOnlyEntry extends SettingEntryBase {
  kind: "search";
}

export type SettingEntry = StagedField | SearchOnlyEntry;

/** Narrow a registry entry to an editable field — filters search-only entries out
 * before the shell renders a control. */
export const isStagedField = (entry: SettingEntry): entry is StagedField => entry.kind === "staged";

/** Define a staged field with its value type checked, erased to StagedField for
 * the heterogeneous registry. */
export function stagedField<V>(def: Omit<StagedField<V>, "kind">): StagedField {
  return { kind: "staged", ...def } as StagedField;
}

// The five tokens every palette supplies (ColorToken makes them mandatory), previewed
// as dots beside each theme option so a future theme renders its swatch with no extra
// wiring — background, the raised surface, ink, the accent, and the positive hue.
const SWATCH_TOKENS = ["--paper", "--paper-raised", "--ink", "--accent", "--ok"] as const;
const themeOptions = THEME_IDS.map((id) => ({
  value: id,
  label: THEMES[id].label,
  swatch: SWATCH_TOKENS.map((token) => THEMES[id].tokens[token]),
}));

const diffStyleOptions = [
  { value: "split", label: "Split" },
  { value: "unified", label: "Unified" },
] as const;

const diffIndicatorOptions = [
  { value: "bars", label: "Bars" },
  { value: "classic", label: "Classic +/−" },
  { value: "both", label: "Both" },
] as const;

/** Every setting the Settings modal surfaces. Each staged field applies through
 * its pref module's existing localStorage key; search-only entries (contributed
 * by later panes) never apply. */
export const SETTINGS_REGISTRY: readonly SettingEntry[] = [
  stagedField<ThemeId>({
    key: "theme",
    category: "Appearance",
    label: "Theme",
    description: "Color palette for the whole interface.",
    control: { kind: "select", options: themeOptions },
    read: readThemeId,
    // applyTheme both persists and applies — the change takes effect immediately.
    write: applyTheme,
  }),
  stagedField<boolean>({
    key: "shortcutHints",
    category: "Appearance",
    label: "Shortcut hints",
    description: "Show key-cap hints and the keyboard button.",
    control: { kind: "toggle" },
    read: readShortcutHints,
    write: writeShortcutHints,
  }),
  stagedField<DiffStyle>({
    key: "diffStyle",
    category: "Appearance",
    section: "Diff view",
    label: "Layout",
    description: "Side-by-side (split) or stacked (unified) diff layout.",
    control: { kind: "select", options: diffStyleOptions },
    read: readDiffStyle,
    write: writeDiffStyle,
  }),
  stagedField<DiffIndicators>({
    key: "diffIndicators",
    category: "Appearance",
    section: "Diff view",
    label: "Change markers",
    description: "Gutter change markers: bars, classic +/− glyphs, or both.",
    control: { kind: "select", options: diffIndicatorOptions },
    read: readDiffIndicators,
    write: writeDiffIndicators,
  }),
];

/** A sidebar category: its id (matched against SettingEntry.category, and shown as
 * both the nav label and the pane title) plus the one-line blurb under the pane
 * header. */
export interface SettingCategory {
  id: string;
  blurb: string;
}

/** The ordered sidebar taxonomy (EXC-843). The two-pane shell renders a nav item
 * per category that has at least one registry entry, in this order, and shows the
 * blurb beneath the pane title. Later panes append their categories here —
 * Notifications (EXC-847), Advanced (EXC-848). */
export const SETTINGS_CATEGORIES: readonly SettingCategory[] = [
  { id: "Appearance", blurb: "How the interface looks, including the diff view." },
];
