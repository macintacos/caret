# Editing `doc/DEVELOPMENT.md`

*Audience: coding agents and contributors editing caret's development guide.*

`doc/DEVELOPMENT.md` is the human-facing development reference behind
[`README.md`](../../../README.md): building from source, the `mise` task catalog and dev
workflow (`mise run build --install`, `mise run dev`, `mise run preflight`), the tasks
CLI, and vendored icons.

When to edit it:

- A `mise` task is added, removed, or changes what it does; the bootstrap or build flow
  changes; a dev-loop gotcha is worth recording.
- The tasks CLI grows a subcommand or changes how forwarders work.
- Keep `CONTRIBUTING.md` the short front door — it orients a new contributor in a page and
  points here for the full catalog.

Use the `/doc-coauthoring` skill for any substantive prose pass — it keeps the section
on-audience and scannable.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
