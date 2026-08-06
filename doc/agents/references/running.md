# Editing `doc/RUNNING.md`

*Audience: coding agents and contributors editing caret's runtime-behavior reference.*

`doc/RUNNING.md` is the human-facing guide to caret in use, behind
[`README.md`](../../../README.md): desktop notifications and their per-origin permission
model, cmux unread marks, and logging & debugging (the log files, the record shape,
`caret redact`, and `caret discovery`).

When to edit it:

- User-visible runtime behavior changes: the notification flow or its permission
  affordances, the cmux integration, what a log record carries, or a diagnostics
  subcommand.
- Logging *conventions* for contributors — when to log, levels, message style — belong in
  [`logging-rules.md`](../logging-rules.md), not here; this page documents what a user
  sees and where.

Use the `/doc-coauthoring` skill for any substantive prose pass — it keeps the section
on-audience and scannable.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
