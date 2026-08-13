# Adding or editing a `doc/agents/*.md` rule file

*Audience: coding agents and contributors adding or editing a rule-of-the-road.*

`doc/agents/*.md` holds caret's rules-of-the-road — one file per code area (architecture,
logging, TypeScript, Svelte, shadcn, testing, icons, settings, OpenCode, rumdl). They are
the substance behind `CLAUDE.md`'s routing digraph; each is concise and scoped to its own
area.

Adding a new rule file:

1. Create `doc/agents/<area>-rules.md` — follow the existing `*-rules.md` naming and the
   concise style of, e.g., [`settings-rules.md`](../settings-rules.md). State its audience
   at the top.
2. Add a routing **edge** to it from the digraph in `CLAUDE.md`, labelled with when to
   read it (see [`claude-md.md`](claude-md.md)).
3. Add it to the documentation map — see the maintenance rule in
   [`documentation-rules.md`](../documentation-rules.md).

Editing an existing rule file: keep it surgical and on-topic; don't fold one area's rules
into another's file.

Use the `/doc-coauthoring` skill for substantive prose passes.
