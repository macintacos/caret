# Editing `doc/ARCHITECTURE.md`

*Audience: coding agents and contributors editing caret's architecture reference.*

`doc/ARCHITECTURE.md` is the human-facing account of how caret works, behind
[`README.md`](../../../README.md): the tool-agnostic core / agent-adapter boundary, the
Claude Code and OpenCode adapter internals, calling the review tool from your own skill,
and the source layout.

When to edit it:

- The core/adapter boundary moves, a new adapter lands, or an adapter's wire contract,
  install flow, or packaging changes.
- The `caret_review_plan` tool's contract changes — who may call it, what it takes, what
  comes back.
- A new top-level directory appears, or one changes what it holds (the § Layout block).

Three couplings to respect. The `rm -rf` cache path in the OpenCode-adapter section is
asserted against `opencodeCachePackageDir()` by
`test/adapters/opencode/docs-cache-path.test.ts`, which requires **exactly one** such line
in the file — don't add a second and don't drop it. The line-anchor claim in § Calling the
review tool from your own skill — the sentence beginning "A feedback line reference
indexes…" — is pinned verbatim and **exactly once** by
`test/structure/line-anchor-claim.test.ts`, which requires the same sentence in
`ui/src/lib/feedback.ts` and `opencode/caret.plugin.ts`: reword it in all three or in
none, and keep emphasis and links out of the sentence, which break the match too. And the
adapter design detail lives in [`opencode-integration.md`](../opencode-integration.md);
this page is the human-facing narrative, not the rule file.

Use the `/doc-coauthoring` skill for any substantive prose pass — it keeps the section
on-audience and scannable.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
