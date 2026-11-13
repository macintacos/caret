# Adding or editing a `docs/agents/*.md` rule file

*Audience: coding agents and contributors adding or editing a rule-of-the-road.*

`docs/agents/*.md` holds caret's rules-of-the-road — one file per code area (architecture,
logging, TypeScript, Svelte, shadcn, plan rendering, testing, icons, settings,
dependencies, OpenCode, pi, rumdl). They are the substance behind `AGENTS.md`'s router;
each is concise and scoped to its own area.

Adding a new rule file:

1. Create `docs/agents/<area>-rules.md` — follow the existing `*-rules.md` naming (an
   agent host's record is `<host>-integration.md`) and the concise style of, e.g.,
   [`settings-rules.md`](../settings-rules.md). State its audience at the top.
2. Add a **stop** that loads it to the `router` fence in `AGENTS.md`, and an exit to it
   labelled with when to read it (see [`agents-md.md`](agents-md.md)).
3. Add it to the documentation map — see the maintenance rule in
   [`documentation-rules.md`](../documentation-rules.md).

Editing an existing rule file: keep it surgical and on-topic; don't fold one area's rules
into another's file.

Use the `/doc-coauthoring` skill for substantive prose passes.
