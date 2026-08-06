# Editing `doc/CONFIGURING.md`

*Audience: coding agents and contributors editing caret's configuration reference.*

`doc/CONFIGURING.md` is the human-facing configuration reference behind
[`README.md`](../../../README.md): platform support, the `config.toml` file and its
tables, the full `CARET_*` environment-variable table, and plan formatting (rumdl). It is
the one place a reader looks up a key, its default, and what it does.

When to edit it:

- A new or changed `config.toml` key or `CARET_*` environment variable — settings land
  with their table row in the same change, per
  [`settings-rules.md`](../settings-rules.md).
- The supported-platform story changes, or plan formatting changes (the pinned rumdl
  version, the reflow shape, the opt-out).
- Keep `README.md` the lean front door — when configuration depth grows, it lands here,
  not there.

Use the `/doc-coauthoring` skill for any substantive prose pass — it keeps the section
on-audience and scannable.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
