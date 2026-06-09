# docs

Project documentation that doesn't belong in the top-level [README](../README.md). Today that's the
agent reference material under [`agents/`](agents/).

`agents/` holds caret's contributor rules-of-the-road — the conventions to follow when working in a
given area: the core/adapter architecture, logging, TypeScript and Svelte idioms, browser and
backend testing, icons, and settings. Each topic is its own file. They are the detail behind the
routing digraph in the repo's [`CLAUDE.md`](../CLAUDE.md): that file decides *which* of these a
given change should pull into context; the files here are the substance.

Adding a new agent-facing rule? Drop it in `agents/` as its own file and add a route to it from the
digraph in `CLAUDE.md`, so the agent knows when to read it.
