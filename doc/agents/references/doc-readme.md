# Editing `doc/README.md`

*Audience: coding agents and contributors editing the `doc/` directory router.*

`doc/README.md` is the router for the `doc/` directory. It leads with a table mapping what
a reader wants to do to the page that answers it — the four reference pages
([`CONFIGURING.md`](../../CONFIGURING.md), [`RUNNING.md`](../../RUNNING.md),
[`ARCHITECTURE.md`](../../ARCHITECTURE.md), [`DEVELOPMENT.md`](../../DEVELOPMENT.md)) and
[`agents/`](../) — and says nothing more about a page than the row that gets a reader
there. It is delineated from the top-level `README.md`, which is the user-facing guide:
this one routes, it does not explain.

When to edit it:

- The contents or shape of `doc/` change — a new subdirectory, a new kind of doc, a moved
  file.
- A page it routes into gains, loses, or renames a section a row points at. `rumdl`'s
  MD051 fails the lint gate on a fragment that stops resolving — including across files —
  but nothing catches a row whose "what you want to do" wording has drifted from what the
  section it points at actually covers. That part is on you.

Keep it a router: one row per reader goal, linking onward rather than duplicating content.
It already points at `agents/documentation-rules.md` as the doc map.

Use the `/doc-coauthoring` skill for substantive prose passes.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
