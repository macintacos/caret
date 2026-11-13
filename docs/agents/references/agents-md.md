# Editing `AGENTS.md`

*Audience: coding agents and contributors editing caret's root `AGENTS.md`.*

`AGENTS.md` is the agent-facing router for **code** changes: its `router` fence maps each
code area to the `docs/agents/*.md` rule file that governs it, and it also carries the
CodeGraph guidance and the `mise run preflight` verification contract.

When to edit it:

- You add, remove, or rename a `docs/agents/*.md` rule file — add or update its
  **exit and stop** in the router so the agent knows when to read it (see
  [`agent-rules.md`](agent-rules.md)).
- The CodeGraph guidance or the verification (`mise run preflight`) contract changes.

Keep edits surgical: the router is a checklist of exits and the prose sections are tuned —
change only what your work requires. (`AGENTS.md` is force-tracked in `.gitignore` and is
referenced as inline code, never a markdown link, so rumdl's link check stays clean.)

Use the `/doc-coauthoring` skill for substantive prose passes.

Maintenance: this doc is a node on the documentation map. Keep
[`documentation-rules.md`](../documentation-rules.md) in sync per its maintenance rule.
