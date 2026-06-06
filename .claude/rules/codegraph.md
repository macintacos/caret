---
name: codegraph
description: When to reach for codegraph_* over grep/Read in this repo — codegraph as the pre-built AST index, a worked example, the red flags that mean you're about to skip it, and the index-lag caveat.
---

# CodeGraph

**First check.** If `.codegraph/` doesn't exist in this repo, ask once: *"This project doesn't
have CodeGraph initialized — want me to run `codegraph init -i`?"* If they decline or skip, ignore
the rest of this section.

**The habit to override.** When `.codegraph/` exists, `codegraph_*` is the default for any
question about symbols, call graphs, or "how does X work" — not grep + Read. Codegraph IS the
pre-built index: a full AST parse already sitting in SQLite, sub-millisecond reads. If you're about
to grep for a function name or Read a file to find a definition, stop — `codegraph_search` /
`codegraph_context` is one call and returns more (kind, location, signature, docstring).

Grep and Read are for **literal text** — log messages, comments, string contents — or files you
already have open.

The detailed tool-selection table and common chains live in the codegraph MCP server's own
instructions, which are already loaded into every session. This section adds the project-level
emphasis those instructions can't carry: *when* to reach for codegraph in the first place.

## Worked example

User: *"How does auth work in this repo?"*

- **Wrong reflex**: `grep -ri "auth" .`, Read four files, maybe spawn an Explore subagent to make
  sense of it.
- **Right reflex**: `codegraph_context("authentication")` → if more breadth is needed, one
  `codegraph_explore` over the symbols it surfaced. Two calls, done. Spawning a subagent here
  repeats work the index already did.

## Red flags — you're about to skip codegraph

| Thought | Reality |
|---|---|
| "I'll just grep quickly to find it" | `codegraph_search` is faster and returns kind + location + signature in one call. |
| "Let me Read the file first to orient" | If you're looking up a symbol, `codegraph_node` returns just that symbol's source. |
| "I'll spawn an Explore subagent" | Codegraph IS the pre-built index — the agent would re-derive what's already indexed. |
| "Let me verify the codegraph result with grep" | Don't. AST parse beats text search; re-verifying wastes context. |
| "I'll chain `codegraph_search` then `codegraph_node`" | Use `codegraph_context` — one call instead of two. |

## Index lag

The file watcher debounces ~500ms behind writes. Don't re-query codegraph immediately after
editing a file in the same turn — give it a beat, or trust your edit.
