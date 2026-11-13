# Editing `CONTRIBUTING.md`

*Audience: coding agents and contributors editing caret's contributor guide.*

`CONTRIBUTING.md` is the short, human-facing front door for developing caret:
`bun install`, the `mise` task workflow (`mise run dev`, `mise run preflight`), and where
tests live. Keep it **minimal** — it orients a new contributor and then points at
`README.md` (the user-facing guide), the `doc/` reference pages (`CONFIGURING.md`,
`RUNNING.md`, `ARCHITECTURE.md`, `DEVELOPMENT.md`), and `doc/agents/` (the
rules-of-the-road) for depth. Don't let it grow into a second README.

When to edit it:

- The local setup or task workflow changes (a new `mise` task a contributor must know, a
  changed bootstrap step).
- The test layout moves.

Environment variables are referenced by **key name only** here; values and the full tables
live in `doc/CONFIGURING.md`. Never put secrets or secret-shaped values in this file.

Use the `/doc-coauthoring` skill for substantive prose passes.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
