# Editing `doc/ADVANCED.md`

*Audience: coding agents and contributors editing caret's advanced reference.*

`doc/ADVANCED.md` is the deep, human-facing reference behind
[`README.md`](../../../README.md): build-from-source, the core/adapter architecture, the
Claude Code and OpenCode adapter internals, the full `config.toml` + `CARET_*`
configuration tables, logging/debugging, and the development workflow. It holds the depth
the README deliberately keeps out of the front door.

When to edit it:

- An advanced or contributor-facing change: build-from-source steps, architecture or
  adapter internals, a `config.toml` key or `CARET_*` env var row (settings land with
  their table row in the same change — see [`settings-rules.md`](../settings-rules.md)),
  the dev workflow, or logging internals.
- Keep `README.md` the lean front door — when depth grows, it lands here, not there.

Use the `/doc-coauthoring` skill for any substantive prose pass — it keeps the section
on-audience and scannable.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
