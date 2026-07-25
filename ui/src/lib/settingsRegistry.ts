// The registry of user-facing settings surfaced in the Settings modal (EXC-837),
// plus the field/control shapes the two-pane shell (EXC-843) renders. Each field
// wraps an existing browser-preference module, so its read/write hit the SAME
// localStorage key the pref already owns (theme, shortcut hints, diff
// style/indicators) — no new keys are registered and existing users'
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

import {
  changeAppearance,
  readSlotTheme,
  readThemeMode,
  THEME_MODES,
  type ThemeMode,
  writeSlotTheme,
  writeThemeMode,
} from "$lib/appearance.ts";
import { readDiffIndicators, writeDiffIndicators } from "$lib/diffIndicatorsPref.ts";
import { readDiffStyle, writeDiffStyle } from "$lib/diffStylePref.ts";
import type { DiffIndicators, DiffStyle } from "$lib/diffview/types.ts";
import type { IconName } from "$lib/icons.ts";
import { readShortcutHints, writeShortcutHints } from "$lib/shortcutHintsPref.ts";
import { type Scheme, type ThemeId, themesForScheme } from "$lib/theme.ts";

/** One choice in a select or segmented control. `swatch` is an optional row of CSS
 * colors rendered as small dots beside the label — the theme options preview their
 * palette this way. `preview` is the option's full theme token map (EXC-753): when
 * present, highlighting the option floats an abstract, tinted preview of Caret's
 * chrome beside the menu. `icon` is a vendored glyph shown before the label, which
 * the segmented mode control uses (sun / moon / monitor). */
export interface SettingOption {
  value: string;
  label: string;
  swatch?: readonly string[];
  preview?: Record<string, string>;
  icon?: IconName;
}

/** How the two-pane shell (EXC-843) renders a field's control: the kind drives
 * both the rendered control and search. `segmented` is the always-visible 3-up
 * form — every option readable at a glance — for a small fixed option set. */
export type SettingControl =
  | { kind: "select"; options: readonly SettingOption[] }
  | { kind: "segmented"; options: readonly SettingOption[] }
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

/** An entry's searchable text: its label plus its description, lowercased. */
function searchText(entry: SettingEntry): string {
  return `${entry.label} ${entry.description}`.toLowerCase();
}

/** Filter registry entries by a case-insensitive substring over label +
 * description (EXC-845 settings search) — the same filter-then-group shape as the
 * shortcuts help (`filterShortcuts` in $lib/shortcuts/help.ts). An empty or
 * whitespace-only query returns every entry; search-only entries (live panes)
 * match the same as staged fields. */
export function filterSettings(
  entries: readonly SettingEntry[],
  query: string,
): readonly SettingEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((entry) => searchText(entry).includes(q));
}

// The five tokens every palette supplies (ColorToken makes them mandatory), previewed
// as dots beside each theme option so a future theme renders its swatch with no extra
// wiring — background, the raised surface, ink, the accent, and the positive hue. The
// hover preview (EXC-753) treats this as its floor: the ThemePreviewCard must paint at
// least these five so the preview never shows fewer colors than the option's dots
// (ThemePreviewCard.test.ts pins that against the exported list).
export const SWATCH_TOKENS = ["--paper", "--paper-raised", "--ink", "--accent", "--ok"] as const;

/** A scheme's slot options: only that scheme's palettes, so the light selector
 * previews light palettes and the dark selector dark ones (EXC-773). */
function slotOptions(scheme: Scheme): SettingOption[] {
  return themesForScheme(scheme).map((theme) => ({
    value: theme.id,
    label: theme.label,
    swatch: SWATCH_TOKENS.map((token) => theme.tokens[token]),
    // The full palette the hover preview (EXC-753) paints Caret's chrome from.
    preview: theme.tokens,
  }));
}

/** The mode control's three fixed choices, each carrying its glyph. */
const MODE_ICONS: Record<ThemeMode, IconName> = {
  light: "sun",
  dark: "moon",
  system: "monitor",
};
const MODE_LABELS: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};
const modeOptions: SettingOption[] = THEME_MODES.map((mode) => ({
  value: mode,
  label: MODE_LABELS[mode],
  icon: MODE_ICONS[mode],
}));

/** The Appearance section whose fields the shell renders as one composite block
 * (ThemeSection.svelte) instead of independent rows. */
export const THEME_SECTION = "Theme";

/** That block's field keys, so the section component can find each without
 * re-spelling a string literal the registry owns. */
export const THEME_FIELD = {
  mode: "themeMode",
  light: "themeLight",
  dark: "themeDark",
} as const;

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
  // The appearance trio (EXC-773). They share the THEME_SECTION label, which the
  // shell renders as one composite block (ThemeSection.svelte) rather than three
  // independent rows — the `IN USE` marker and the resolved-state line only make
  // sense across all three. Each write persists then repaints as a wipe, so the
  // change takes effect immediately. Every label/description carries the word
  // "theme" so a `/`-search for it keeps the block together.
  stagedField<ThemeMode>({
    key: "themeMode",
    category: "Appearance",
    section: THEME_SECTION,
    label: "Mode",
    description: "Follow the system theme, or pin light or dark.",
    control: { kind: "segmented", options: modeOptions },
    read: readThemeMode,
    write: (mode) => {
      writeThemeMode(mode);
      changeAppearance();
    },
  }),
  stagedField<ThemeId>({
    key: "themeLight",
    category: "Appearance",
    section: THEME_SECTION,
    label: "Light theme",
    description: "Color palette used while the light scheme is showing.",
    control: { kind: "select", options: slotOptions("light") },
    read: () => readSlotTheme("light"),
    write: (id) => {
      writeSlotTheme("light", id);
      changeAppearance();
    },
  }),
  stagedField<ThemeId>({
    key: "themeDark",
    category: "Appearance",
    section: THEME_SECTION,
    label: "Dark theme",
    description: "Color palette used while the dark scheme is showing.",
    control: { kind: "select", options: slotOptions("dark") },
    read: () => readSlotTheme("dark"),
    write: (id) => {
      writeSlotTheme("dark", id);
      changeAppearance();
    },
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
  // Live, browser-owned notification permission (EXC-847): a search-only entry so
  // /-search (EXC-845) finds it. The pane itself (NotificationsPane) renders the
  // live state and the enable / test affordance — there is nothing to persist.
  {
    kind: "search",
    key: "notifications",
    category: "Notifications",
    label: "Desktop notifications",
    description: "Get alerted when a new plan is ready for review; check the permission state.",
  },
  // Read-only install diagnostics (EXC-848): one search-only entry per block so
  // /-search (EXC-845) finds each, and — since the shell renders a category only
  // when it has ≥1 entry — so the Advanced nav row appears at all. AdvancedPane
  // fetches and renders the live values; nothing here persists.
  {
    kind: "search",
    key: "advancedVersion",
    category: "Advanced",
    label: "Version",
    description: "The running caret version, build id, and commit.",
  },
  {
    kind: "search",
    key: "advancedDaemon",
    category: "Advanced",
    label: "Daemon status",
    description: "Whether the daemon is live, its port, and how long it has been running.",
  },
  {
    kind: "search",
    key: "advancedSystem",
    category: "Advanced",
    label: "System",
    description: "The operating system, architecture, and runtime version.",
  },
  {
    kind: "search",
    key: "advancedConfig",
    category: "Advanced",
    label: "Config",
    description: "The parsed config file and its path on disk.",
  },
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
  { id: "Notifications", blurb: "Desktop alerts when a new plan is ready for review." },
  { id: "Advanced", blurb: "Read-only details about this install. Click a block to copy it." },
];
