# doc

*Audience: contributors and agents navigating caret's `doc/` directory.*

Project documentation that doesn't belong in the top-level [README](../README.md). Today
that's the agent reference material under [`agents/`](agents/).

`agents/` holds caret's contributor rules-of-the-road — the conventions to follow when
working in a given area: the core/adapter architecture, logging, TypeScript and Svelte
idioms, browser and backend testing, icons, and settings. Each topic is its own file. They
are the detail behind the routing digraph in the repo's `CLAUDE.md`: that file decides
*which* of these a given change should pull into context; the files here are the
substance.

For the wider picture — every doc in the repo and which one to update when — see
[`agents/documentation-rules.md`](agents/documentation-rules.md). It maps the whole doc
landscape (this index, the top-level README, `CONTRIBUTING.md`, the CHANGELOG, and the
`agents/` rule files) and carries the rule that adding, removing, or renaming a doc
updates that map in the same change.

Adding a new agent-facing rule? Drop it in `agents/` as its own file, add a route to it
from the digraph in `CLAUDE.md`, and update the doc map in
[`agents/documentation-rules.md`](agents/documentation-rules.md) — see that file's
maintenance rule.
