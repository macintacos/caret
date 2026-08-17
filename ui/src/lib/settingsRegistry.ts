// The registry of user-facing settings surfaced in the Settings modal (EXC-837),
// plus the field/control shapes the two-pane shell (EXC-843) renders. Each field
// wraps a browser-preference module and reads/writes through the key that module
// owns, never one of its own — so a field over an existing pref (theme, shortcut
// hints, diff style/indicators) leaves users' stored values untouched, and a field
// over a new one (sound) registers its key there rather than here. Editing a
// setting applies it immediately: the shell
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

import { appearance } from "@/state/appearance.svelte.ts";
import { THEME_MODES, type ThemeMode } from "$lib/appearance.ts";
import { readDiffIndicators, writeDiffIndicators } from "$lib/diffIndicatorsPref.ts";
import { readDiffStyle, writeDiffStyle } from "$lib/diffStylePref.ts";
import type { DiffIndicators, DiffStyle } from "$lib/diffview/types.ts";
import type { IconName } from "$lib/icons.ts";
import { readShortcutHints, writeShortcutHints } from "$lib/shortcutHintsPref.ts";
import {
  readSoundEnabled,
  readSoundVolume,
  writeSoundEnabled,
  writeSoundVolume,
} from "$lib/soundPref.ts";
import { type Scheme, type ThemeId, themesForScheme } from "$lib/theme.ts";

/** One choice in a select or segmented control. `swatch` is an optional row of CSS
 * colors rendered as small dots beside the label — the theme options preview their
 * palette this way. `preview` is the option's theme id (EXC-753): when present,
 * highlighting the option floats an abstract preview of Caret's chrome beside the
 * menu, painted in that theme. `icon` is a vendored glyph shown before the label,
 * which the segmented mode control uses (sun / moon / monitor). */
export interface SettingOption {
  value: string;
  label: string;
  swatch?: readonly string[];
  preview?: ThemeId;
  icon?: IconName;
}

/** How the two-pane shell (EXC-843) renders a field's control: the kind drives
 * both the rendered control and search. `segmented` is the always-visible 3-up
 * form — every option readable at a glance — for a small fixed option set.
 *
 * `slider` (EXC-1101) is the one continuous control, and carries no range of its
 * own: its value is a WHOLE PERCENT, 0–100, and SettingSlider.svelte owns that
 * scale. A field whose preference is stored in another unit converts inside its own
 * read/write — sound volume stores a 0–1 multiplier — which keeps the conversion
 * beside the pref that needs it rather than spreading min/max/step/unit config
 * through a registry holding exactly one continuous setting. */
export type SettingControl =
  | { kind: "select"; options: readonly SettingOption[] }
  | { kind: "segmented"; options: readonly SettingOption[] }
  | { kind: "slider" }
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

// The label↔control wiring for a settings row (EXC-1112). Every pane that renders a
// row spells these two ids, and the invariant binding them — a row's `<label for>` is
// its control's `id` — is what supplies the control its accessible name. Spelled
// inline at each site, a single typo would leave that control silently unnamed with
// nothing to fail on it, so the convention lives here beside the field shape it keys
// off.

/** A setting control's DOM id — what its row's `<label for>` points at. */
export const settingControlId = (key: string): string => `setting-${key}`;

/** A setting row's `<label>` id — the target for a composite control's
 * `aria-labelledby`, and what names the row's own group. */
export const settingLabelId = (key: string): string => `${settingControlId(key)}-label`;

/** What a row's `<label for>` may point at, or `undefined` when nothing may. `for` binds
 * only to a LABELABLE element, and two controls render roots that are not: a segmented
 * control is a `<div role="group">`, and a slider a bits-ui `<span>` whose `role="slider"`
 * lives on the thumb inside it. Those rows name their control through `aria-labelledby`
 * and leave `for` off entirely, rather than pointing it at an element that cannot
 * honour it. */
export const settingLabelTarget = (field: StagedField): string | undefined =>
  field.control.kind === "segmented" || field.control.kind === "slider"
    ? undefined
    : settingControlId(field.key);

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
// hover preview (EXC-753) treats this as its floor: the ThemePreviewCard must reference
// at least these five so the preview never shows fewer colors than the option's dots
// (ThemePreviewCard.test.ts pins that against the exported list).
export const SWATCH_TOKENS = ["--paper", "--paper-raised", "--ink", "--accent", "--ok"] as const;

/** A scheme's slot options: only that scheme's palettes, so the light selector
 * previews light palettes and the dark selector dark ones (EXC-773). */
function slotOptions(scheme: Scheme): SettingOption[] {
  return themesForScheme(scheme).map((theme) => ({
    value: theme.id,
    label: theme.label,
    swatch: SWATCH_TOKENS.map((token) => theme.tokens[token]),
    // The palette the hover preview (EXC-753) paints Caret's chrome in.
    preview: theme.id,
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

/** The same three keys as a plain list, for callers asking only "is this a theme
 * field?" — App's applySetting, which gives a theme change its own sound. */
export const THEME_KEYS: readonly string[] = Object.values(THEME_FIELD);

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
 * its own pref module's localStorage key; search-only entries (contributed by
 * later panes) never apply. */
export const SETTINGS_REGISTRY: readonly SettingEntry[] = [
  // The appearance trio (EXC-773). They share the THEME_SECTION label, which the
  // shell renders as one composite block (ThemeSection.svelte) rather than three
  // independent rows — the `IN USE` marker and the resolved-state line only make
  // sense across all three. Each one reads and commands the live appearance
  // (@/state/appearance.svelte.ts), which owns the persist-then-repaint sequence,
  // so the change takes effect immediately. Every label/description carries the
  // word "theme" so a `/`-search for it keeps the block together.
  stagedField<ThemeMode>({
    key: "themeMode",
    category: "Appearance",
    section: THEME_SECTION,
    label: "Mode",
    description: "Follow the system theme, or pin light or dark.",
    control: { kind: "segmented", options: modeOptions },
    read: () => appearance.mode,
    write: (mode) => appearance.setMode(mode),
  }),
  stagedField<ThemeId>({
    key: "themeLight",
    category: "Appearance",
    section: THEME_SECTION,
    label: "Light theme",
    description: "Color palette used while the light scheme is showing.",
    control: { kind: "select", options: slotOptions("light") },
    read: () => appearance.slots.light,
    write: (id) => appearance.setSlot("light", id),
  }),
  stagedField<ThemeId>({
    key: "themeDark",
    category: "Appearance",
    section: THEME_SECTION,
    label: "Dark theme",
    description: "Color palette used while the dark scheme is showing.",
    control: { kind: "select", options: slotOptions("dark") },
    read: () => appearance.slots.dark,
    write: (id) => appearance.setSlot("dark", id),
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
  // The one off-switch for every sound caret makes (EXC-1100). The sound layer reads
  // the same preference on every play, so flipping this silences the app on the next
  // cue with nothing to resync.
  stagedField<boolean>({
    key: "sound",
    category: "Sound",
    label: "Sounds",
    description: "Play a short cue when a plan arrives, a decision lands, or something fails.",
    control: { kind: "toggle" },
    read: readSoundEnabled,
    write: writeSoundEnabled,
  }),
  // How loud those cues are (EXC-1101), read per play by the same sound layer. The
  // control speaks whole percents and the preference a 0–1 multiplier, so the conversion
  // sits here — the one place that knows both units.
  //
  // The read SNAPS to the control's own 5% ladder rather than merely rounding, and that
  // is load-bearing rather than tidiness: bits-ui's slider watches its value and quietly
  // rewrites an off-step one to the nearest step, which travels back out through the
  // binding as if the reviewer had moved it — so a stored volume off the ladder would
  // write, toast and chime the instant the pane opened. Rounding alone leaves that live
  // (float drift is real here too: 0.55 * 100 is 55.00000000000001, though 0.25 * 100 is
  // exactly 25), so the ladder is what actually closes it.
  stagedField<number>({
    key: "soundVolume",
    category: "Sound",
    label: "Volume",
    description: "How loud caret's sounds play.",
    control: { kind: "slider" },
    read: () => Math.round(readSoundVolume() * 20) * 5,
    write: (percent) => writeSoundVolume(percent / 100),
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
 * Sound (EXC-1100), Notifications (EXC-847), Advanced (EXC-848). Sound sits directly
 * before Notifications: both are how caret gets the reviewer's attention, so they read
 * as a pair. */
export const SETTINGS_CATEGORIES: readonly SettingCategory[] = [
  { id: "Appearance", blurb: "How the interface looks, including the diff view." },
  { id: "Sound", blurb: "Short cues when a plan arrives and a decision lands." },
  { id: "Notifications", blurb: "Desktop alerts when a new plan is ready for review." },
  { id: "Advanced", blurb: "Read-only details about this install. Click a block to copy it." },
];
