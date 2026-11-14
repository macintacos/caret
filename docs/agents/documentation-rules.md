# Documentation Rules

*Audience: coding agents and contributors making **documentation** changes in caret.*

`AGENTS.md` routes a **code** change to the rule file that governs it. This file is the
mirror for **docs**: it maps every piece of documentation caret ships and decides
*which one* a given change should update. Reach for it whenever you are about to write or
edit prose — a feature's user docs, a contributor note, a new rule-of-the-road — and
aren't sure where it belongs.

Like `AGENTS.md`'s router, walk the `router` fence from `@changing-documentation`.
`which-doc` fans out, because a change can touch several docs at once:
**update every doc whose exit label matches**. Each of those docs has a pointer file under
[`references/`](references/) that says *how* to edit it; those are loaded on demand, not
all at once.

## Routing

```router
@changing-documentation: Changing documentation
  > which-doc
which-doc: Edit every doc the change affects
  user-facing front door: what caret is, install, basic usage, pointers onward > readme
  configuration reference: platform support, config.toml, the CARET_* tables, plan formatting, theme files > configuring
  runtime behavior a user sees: desktop notifications, cmux unread marks, logging and debugging > running
  how caret works: the core/adapter boundary, adapter internals, the review tool, the source layout > architecture
  developing caret: build-from-source, the mise task catalog and dev workflow, the tasks CLI, icons > development
  human contributor onboarding: local setup, the mise workflow, where tests live > contributing
  the code-change routing index, plus the CodeGraph / verifying-changes prose > agents
  a rule-of-the-road for a code area (architecture, logging, TS, Svelte, shadcn, plan rendering, testing, icons, settings, dependencies, OpenCode, pi, rumdl) > edit-a
  the router for the docs/ directory: which page answers a given reader's question > readme-2
  design direction: how caret looks, moves, sounds, or prints, its deliberate exceptions, and the decision log > edit-design
  a user-facing page on the docs site (tutorial, how-to guide, reference, explanation) or its place in the site's nav > site
readme!: Edit README.md
configuring!: Edit docs/CONFIGURING.md
running!: Edit docs/RUNNING.md
architecture!: Edit docs/ARCHITECTURE.md
development!: Edit docs/DEVELOPMENT.md
contributing!: Edit CONTRIBUTING.md
agents!: Edit AGENTS.md
edit-a!: Edit a docs/agents/*.md rule file
readme-2!: Edit docs/README.md
edit-design!: Edit design/*.md
site!: Edit the docs/ page and its zensical.toml nav entry
```

## The doc landscape

- **`README.md`** (repo root) — the lean, user-facing front door: what caret is, install,
  basic usage, and pointers onward. It leads with the install audience; the advanced and
  contributor-facing depth lives in the four `docs/` reference pages below, which it links
  to directly or reaches through [`docs/README.md`](../README.md). How to edit it:
  [`references/readme.md`](references/readme.md).
- **`docs/CONFIGURING.md`** — the configuration reference behind `README.md`: platform
  support, the `config.toml` file, the full `CARET_*` tables, plan formatting, and theme
  files. How to edit it: [`references/configuring.md`](references/configuring.md).
- **`docs/RUNNING.md`** — caret in use: desktop notifications, cmux unread marks, and
  logging & debugging. How to edit it: [`references/running.md`](references/running.md).
- **`docs/ARCHITECTURE.md`** — how caret works: the tool-agnostic core / agent-adapter
  boundary, the Claude Code, OpenCode, and pi adapter internals, calling the review tool,
  and the source layout. How to edit it:
  [`references/architecture.md`](references/architecture.md).
- **`docs/DEVELOPMENT.md`** — developing caret: build-from-source, the `mise` task catalog
  and dev workflow, the tasks CLI, and icons. How to edit it:
  [`references/development.md`](references/development.md).
- **`CONTRIBUTING.md`** (repo root) — the short, human-facing front door for people who
  want to develop caret: `bun install`, the `mise` task workflow, and where tests live. It
  stays minimal and points at `README.md`, the `docs/` reference pages, and `docs/agents/`
  for depth. How to edit it: [`references/contributing.md`](references/contributing.md).
- **`AGENTS.md`** (repo root) — the agent-facing router for **code** changes, plus the
  CodeGraph and verifying-changes guidance. Adding or moving a `docs/agents/*.md` rule
  file means adding or updating its exit and stop here. How to edit it:
  [`references/agents-md.md`](references/agents-md.md).
- **`docs/agents/*.md`** — the rules-of-the-road: one file per code area, the substance
  behind `AGENTS.md`'s router. This routing reference lives among them. How to add or edit
  one: [`references/agent-rules.md`](references/agent-rules.md).
- **`docs/README.md`** — the router for the `docs/` directory: a table mapping what a
  reader wants to do to the page that answers it, across the four reference pages,
  `docs/agents/`, and the two repo-root docs (`README.md` and `CONTRIBUTING.md`). How to
  edit it: [`references/doc-readme.md`](references/doc-readme.md).
- **`design/`** (repo root) — caret's design direction: the brief, where each token lives,
  the patterns, the deliberate exceptions, and the decision log, routed from
  `design/README.md`. Read by contributors and coding agents alike. How to edit it:
  [`references/design.md`](references/design.md).
- **The docs site** — `zensical.toml`, `docs/index.md`, and the `docs/tutorial/`,
  `docs/how-to/`, `docs/reference/`, and `docs/explanation/` sections. It is the
  user-facing site, published to https://macintacos.github.io/caret/ on each `v*` release
  tag. Its nav in `zensical.toml` decides what a reader can reach, and `exclude_docs`
  keeps repo-only pages off it. How to edit it:
  [`references/site.md`](references/site.md).

## Audience, stated at the top of every new doc

`README.md`, `CONTRIBUTING.md`, and everything directly under `docs/` — `docs/README.md`
plus the four reference pages (`CONFIGURING.md`, `RUNNING.md`, `ARCHITECTURE.md`,
`DEVELOPMENT.md`) — are **human-facing**, as are the docs site's pages. `AGENTS.md` and
everything under `docs/agents/` — the rule files and this file's `references/` pointers —
are **agent-facing**. State the audience explicitly at the top of each new doc so a reader
knows in one line whether it is written for them.

Diagrams follow the same split, **deliberately**: human-facing docs use **mermaid**, which
GitHub renders inline, and agent-facing docs use **graphviz**, which agents read as text.
This is not an inconsistency to reconcile — don't convert one to the other.

## Prose passes: use `/doc-coauthoring`

Drive substantive prose edits through the `/doc-coauthoring` skill rather than ad-hoc
drafting. It walks the audience, the reader's goal, structure, and a readability pass —
which is exactly what keeps these docs scannable and on-audience. The pointer files repeat
this call-out per doc.

## The maintenance rule

Documentation drifts when the map and the docs are edited in separate changes. So:
**adding, removing, or renaming a doc updates, in the same change,**

1. **this map** — the router above and the doc-landscape entry, and
2. **its `AGENTS.md` route**, if the doc is a `docs/agents/*.md` rule file with one, and
3. **its pointer file** under [`references/`](references/) — for a `docs/agents/*.md` rule
   file that is the shared [`references/agent-rules.md`](references/agent-rules.md), whose
   area list you extend rather than adding a new pointer, and
4. **its `zensical.toml` nav entry**, if the doc is a page on the docs site.

A doc that exists without a place on this map is a doc no one will find.
