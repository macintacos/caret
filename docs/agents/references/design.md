# Editing `design/`

*Audience: coding agents and contributors editing caret's design direction.*

`design/` holds caret's design direction, routed from
[`design/README.md`](../../../design/README.md): the brief, where each token lives, the
patterns, the deliberate exceptions, and the decision log. It records intent and points at
the code for every value.

When to edit it:

- A design decision is made or reversed: add a dated entry to `decisions.md`, and update
  `patterns.md` if the decision changes how something is built.
- Code catches up with a decision, or a floor gap is fixed: remove its line from the open
  list in `decisions.md`.
- A token moves to a new home: update `tokens.md`. A token's value changes at its source,
  never here.
- Code-area rules (how a Svelte component is shaped, how the plan renders) belong in
  [`doc/agents/`](../), not here; `design/` says what the result should look and feel
  like.

`design/README.md` says how each page is kept. `/taste document` re-extracts the direction
from the code, and `/taste review` checks a UI against it.

Maintenance: this directory is a node on the documentation map. If you add, rename, or
restructure a page, update [`documentation-rules.md`](../documentation-rules.md) per its
maintenance rule.
