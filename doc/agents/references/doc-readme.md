# Editing `doc/README.md`

*Audience: coding agents and contributors editing the `doc/` directory router.*

`doc/README.md` is the router for the `doc/` directory. It leads with a table mapping what
a reader wants to do to the page that answers it — the four reference pages
([`CONFIGURING.md`](../../CONFIGURING.md), [`RUNNING.md`](../../RUNNING.md),
[`ARCHITECTURE.md`](../../ARCHITECTURE.md), [`DEVELOPMENT.md`](../../DEVELOPMENT.md)),
[`agents/`](../), and the two repo-root docs (`README.md` for install, `CONTRIBUTING.md`
for first-time local setup). The table says nothing more about a page than the row that
gets a reader there; only the `agents/` section below it expands, because `agents/` is a
directory rather than a page and a bare listing is not a destination.

When to edit it:

- The contents or shape of `doc/` change — a new subdirectory, a new kind of doc, a moved
  file.
- A page it routes into gains, loses, or renames a section a row points at. A whole-tree
  `mise run lint` catches a fragment that stops resolving — `rumdl`'s MD051 resolves a
  cross-file fragment only when the target file is in the same scan, so the pre-commit
  hook, which sees only staged files, will not. Nothing catches a row whose "what you want
  to do" wording has drifted from what the section actually covers; that part is on you.

Keep it a router: one row per reader goal, linking onward rather than duplicating content.
It already points at `agents/documentation-rules.md` as the doc map.

Use the `/doc-coauthoring` skill for substantive prose passes.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
