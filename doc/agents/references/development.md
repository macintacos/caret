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

Two couplings to respect.

`## Development` is load-bearing as an anchor:
[`CONTRIBUTING.md`](../../../CONTRIBUTING.md), [`ARCHITECTURE.md`](../../ARCHITECTURE.md),
and the router in [`doc/README.md`](../../README.md) all link
`DEVELOPMENT.md#development`; the router also points at `### The tasks CLI`. `rumdl`'s
MD051 does check cross-file fragments, so renaming or flattening one of these fails the
lint gate rather than breaking silently — but the gate can't tell you the new name is
worse, or that a router row's wording no longer matches the section it lands on.

`scripts/tasks/dev/fake-plan.md` cites this file **by line** — `:124`, `:154-162`,
`:200-212` — and its bullets assert what the preview does with them: the `:154-162` bullet
needs at least 192 lines here and the `:200-212` bullet at least 212, and `:124` is meant
to sit mid-file with a large strip above and below. Nothing in CI guards any of that. If a
pass shortens this page, recheck those three citations by running `mise run dev` and
clicking them.

Use the `/doc-coauthoring` skill for any substantive prose pass — it keeps the section
on-audience and scannable.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
