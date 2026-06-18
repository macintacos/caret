# Editing `CLAUDE.md`

*Audience: coding agents and contributors editing caret's root `CLAUDE.md`.*

`CLAUDE.md` is the agent-facing router for **code** changes: its routing digraph maps each
code area to the `doc/agents/*.md` rule file that governs it, and it also carries the
CodeGraph guidance and the `mise run preflight` verification contract.

When to edit it:

- You add, remove, or rename a `doc/agents/*.md` rule file — add or update its **edge** in
  the digraph so the agent knows when to read it (see [`agent-rules.md`](agent-rules.md)).
- The CodeGraph guidance or the verification (`mise run preflight`) contract changes.

Keep edits surgical: the digraph is a checklist of edges and the prose sections are tuned
— change only what your work requires. (`CLAUDE.md` is force-tracked in `.gitignore` and
is referenced as inline code, never a markdown link, so rumdl's link check stays clean.)

Use the `/doc-coauthoring` skill for substantive prose passes.

Maintenance: this doc is a node on the documentation map. Keep
[`documentation-rules.md`](../documentation-rules.md) in sync per its maintenance rule.
