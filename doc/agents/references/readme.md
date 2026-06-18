# Editing `README.md`

*Audience: coding agents and contributors editing caret's top-level README.*

`README.md` is the comprehensive, user-facing guide and the project's front page. It leads
with the install/usage audience and stays the single source of truth for users — do
**not** split user-facing content into a separate guide; add or revise sections in place.

When to edit it:

- A user-visible change: a new install path, a new command, a `config.toml` key or
  `CARET_*` env var (settings land with their README row in the same change — see
  [`settings-rules.md`](../settings-rules.md)), changed behavior, or a new how-it-works
  detail.
- Keep the development notes accurate, but route human-onboarding basics to
  `CONTRIBUTING.md` rather than duplicating them here at length.

Use the `/doc-coauthoring` skill for any substantive prose pass — it keeps the section
on-audience and scannable.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
