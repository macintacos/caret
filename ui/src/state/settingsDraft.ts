// The staged-draft store behind the Settings modal (EXC-837). A plain factory
// over an injected reactive store — the same shape as the other state modules
// (compare, alerts): App.svelte owns the `$state` backing store, this module
// owns the staging behavior, and tests drive it with a plain store + fake fields.
//
// Editing a setting stages its value here instead of persisting; the float-chip
// (EXC-843) commits every staged write on Save or reverts on Discard. Dirty is
// value-equality against each field's persisted value: staging never persists,
// so read() stays at the pre-edit baseline until save() — a staged key present
// in the store simply means "differs from read()". So re-selecting the original
// value clears the field's dirty state, and an empty save is a no-op. Per-field
// onStage/onRevert hooks let a field preview live (theme, EXC-753) without this
// store knowing anything about themes.

import type { StagedField } from "$lib/settingsRegistry.ts";

/** Reactive backing store App.svelte owns: the staged value per field key. A key
 * is present only while its staged value differs from the field's baseline. */
export interface SettingsDraftStore {
  staged: Record<string, unknown>;
}

/** One field's pending change, for the unsaved-changes confirm (old → new). */
export interface StagedChange {
  key: string;
  label: string;
  from: string;
  to: string;
}

export interface SettingsDraft {
  /** The effective value for a field's control: its staged value if any, else the
   * persisted value. */
  value(key: string): unknown;
  /** Stage a value. Re-staging the field's baseline clears it (value-equality).
   * Fires the field's onStage hook (including back-to-baseline) for live preview. */
  stage(key: string, value: unknown): void;
  /** Whether any field is staged. */
  isDirty(): boolean;
  /** Number of staged fields — the float-chip's "N unsaved changes" count. */
  dirtyCount(): number;
  /** Each staged field's old → new labels, for the confirm preview. */
  changes(): StagedChange[];
  /** Commit every staged write through its field, then clear the draft. A no-op
   * when nothing is staged. */
  save(): void;
  /** Revert every staged field's live preview (onRevert with the baseline), then
   * clear the draft. Never persists. */
  discard(): void;
}

export function createSettingsDraft(
  store: SettingsDraftStore,
  fields: readonly StagedField[],
): SettingsDraft {
  const byKey = new Map(fields.map((f) => [f.key, f]));

  // ponytail: value-equality via Object.is holds for the scalar values every
  // current setting stages (string enums, boolean). Add a per-field `equals` if a
  // future setting stages a non-scalar.
  const omit = (key: string): Record<string, unknown> =>
    Object.fromEntries(Object.entries(store.staged).filter(([k]) => k !== key));

  return {
    value(key) {
      return key in store.staged ? store.staged[key] : byKey.get(key)?.read();
    },

    stage(key, value) {
      const field = byKey.get(key);
      if (!field) return;
      store.staged = Object.is(value, field.read()) ? omit(key) : { ...store.staged, [key]: value };
      field.onStage?.(value);
    },

    isDirty() {
      return Object.keys(store.staged).length > 0;
    },

    dirtyCount() {
      return Object.keys(store.staged).length;
    },

    changes() {
      return Object.entries(store.staged).map(([key, to]) => {
        const field = byKey.get(key);
        const describe = field?.describe ?? String;
        return { key, label: field?.label ?? key, from: describe(field?.read()), to: describe(to) };
      });
    },

    save() {
      for (const [key, value] of Object.entries(store.staged)) {
        byKey.get(key)?.write(value);
      }
      store.staged = {};
    },

    discard() {
      for (const key of Object.keys(store.staged)) {
        const field = byKey.get(key);
        field?.onRevert?.(field.read());
      }
      store.staged = {};
    },
  };
}
