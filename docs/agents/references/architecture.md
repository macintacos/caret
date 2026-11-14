# Editing `docs/ARCHITECTURE.md`

*Audience: coding agents and contributors editing caret's architecture reference.*

`docs/ARCHITECTURE.md` is the contributor account of caret's internals, kept off the docs
site: the tool-agnostic core / agent-adapter boundary, the daemon's lifecycle, the Claude
Code, OpenCode, and pi adapter internals, the source layout, and where the built-in theme
files live.

When to edit it:

- The core/adapter boundary moves, a new adapter lands, or an adapter's wire contract,
  install flow, or packaging changes.
- A review tool's contract changes (OpenCode's and pi's `caret_review_plan` or Claude
  Code's `review_plan` — who may call it, what it takes, what comes back): edit
  [`docs/how-to/review-tool.md`](../../how-to/review-tool.md) instead, under
  [`site.md`](site.md).
- A new top-level directory appears, or one changes what it holds (the § Layout block).

A change a user can see also updates the matching `docs/explanation/` page:
`caret-install.md`, `background-service.md`, or `how-caret-works.md`.

The adapter design detail lives in [`opencode-integration.md`](../opencode-integration.md)
and [`pi-integration.md`](../pi-integration.md); this page is the human-facing narrative,
not the rule file.

Use the `/doc-coauthoring` skill for any substantive prose pass — it keeps the section
on-audience and scannable.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
