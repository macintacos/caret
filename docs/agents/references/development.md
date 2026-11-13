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
MD051 resolves a cross-file fragment only when the file it points into is in the same
scan, so a whole-tree `mise run lint` catches the break but the pre-commit hook — staged
files only — does not. Rename one of these and run the full gate, not just the hook.

`scripts/tasks/dev/fake-plan.md` cites this file **by line**, in several places, and its
bullets assert what the preview does with them.
[`test/scripts/dev-driver.test.ts`](../../../test/scripts/dev-driver.test.ts) guards the
citations: it parses them out of the fixture and fails if one runs past the end of this
page, if the line a citation opens on is blank, or if the page is too short for the
preview's window to reach past the deepest one. What it cannot check is how the result
renders, so a pass that reshapes this page still wants one `mise run dev` and a click on
each.

Use the `/doc-coauthoring` skill for any substantive prose pass — it keeps the section
on-audience and scannable.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
