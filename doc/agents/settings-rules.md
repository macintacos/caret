# Settings Rules

When you introduce a new user setting — a `config.toml` key or a `CARET_*` environment
variable — it must land **with its documentation in the same change**. A setting that
exists only in code is undiscoverable; `doc/CONFIGURING.md` is the configuration
reference.

- **Schema.** For a `config.toml` key, add it to `SettingsSchema` in
  `src/config/settings.ts` with a default and a comment citing the introducing issue
  (existing keys follow this pattern, e.g. `level: ... // EXC-398`).
- **Reference doc.** Document it in `doc/CONFIGURING.md`: config-file keys as a row in the
  relevant table under `## Config file` (e.g. the `[logging]` table), environment
  variables as a row in the **Runtime** table under `## Environment variables` — unless
  the var is dev-only or preflight-only, which have their own tables there.
- **Hot-reload.** If the setting is read live, note its hot-reload semantics — the
  settings service re-reads `config.toml` on change, so daemon-held settings take effect
  without a restart.
- **Browser-persisted UI settings.** A user-facing setting the UI persists in the browser
  (localStorage — e.g. theme, first-run onboarding, diff-view prefs) is not a
  `config.toml` key. Build it with `definePref` / `defineFlagPref` (or, for a bespoke
  read/write, `registerPrefKey`) from `ui/src/lib/definePref.ts`: each registers the key
  so `mise run dev --fresh` resets it — that flag reproduces a brand-new-user session, and
  a key missing from the reset set silently survives it. There is no hand-maintained list
  to update: `knownPrefKeys()` derives from the registrations, and `prefKeys.test.ts`
  fails if any persisted `caret.*` key isn't registered.
