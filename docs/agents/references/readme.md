# Editing `README.md`

*Audience: coding agents and contributors editing caret's top-level README.*

`README.md` is the landing page: what caret is, the screenshot, a one-line install, and
links to the docs site and `CONTRIBUTING.md`, and the license. User documentation lives on
the docs site, built from `docs/`; when content gets deep, it lands there, under the rules
in [`site.md`](site.md), not here.

When to edit it:

- A user-visible change to the landing page: a changed one-line install command or a
  pointer that needs updating. The same install command also appears in
  [`docs/how-to/install.md`](../../how-to/install.md) § Install and
  [`docs/tutorial/first-plan.md`](../../tutorial/first-plan.md) § Install caret; change
  all three together. Install details belong in
  [`docs/how-to/install.md`](../../how-to/install.md). Deep configuration detail belongs
  on the docs site, and architecture and dev-workflow detail in `docs/ARCHITECTURE.md` and
  `docs/DEVELOPMENT.md` — and new `config.toml` / `CARET_*` rows land in
  [`config-file.md`](../../reference/config-file.md) and
  [`environment-variables.md`](../../reference/environment-variables.md) (see
  [`settings-rules.md`](../settings-rules.md)).
- Route human-onboarding basics to `CONTRIBUTING.md` rather than duplicating them here.

Use the `/doc-coauthoring` skill for any substantive prose pass — it keeps the section
on-audience and scannable.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
