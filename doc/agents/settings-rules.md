# Settings Rules

When you introduce a new user setting — a `config.toml` key or a `CARET_*` environment
variable — it must land **with its documentation in the same change**. A setting that
exists only in code is undiscoverable; `doc/ADVANCED.md` is the configuration reference.

- **Schema.** For a `config.toml` key, add it to `SettingsSchema` in
  `src/config/settings.ts` with a default and a comment citing the introducing issue
  (existing keys follow this pattern, e.g. `level: ... // EXC-398`).
- **Reference doc.** Document it in `doc/ADVANCED.md`'s `## Configuration` section:
  config-file keys as a row in the relevant table under `### Config file` (e.g. the
  `[logging]` table), environment variables as a row in the `### Environment variables`
  table.
- **Hot-reload.** If the setting is read live, note its hot-reload semantics — the
  settings service re-reads `config.toml` on change, so daemon-held settings take effect
  without a restart.
- **Browser-persisted UI settings.** A user-facing setting the UI persists in the browser
  (localStorage — e.g. theme, first-run onboarding, diff-view prefs) is not a
  `config.toml` key. Register its key in `KNOWN_PREF_KEYS` (`ui/src/lib/prefs.ts`) so
  `mise run dev --fresh` resets it — that flag reproduces a brand-new-user session, and a
  setting missing from the registry silently survives the reset.
