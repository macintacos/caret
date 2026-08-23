# Editing `.greptile/rules.md`

*Audience: coding agents and contributors retuning how the Greptile PR reviewer reviews.*

`.greptile/rules.md` is free prose handed to the Greptile PR reviewer on every review: its
stance, its priority order, its blast-radius mandate, and the classes of finding it should
not write. Edit it when reviews come back mis-pitched — too noisy, too timid, or aimed at
the wrong layer.

`rules.md` or `config.json`? They are not interchangeable:

- **`rules.md`** — repo-wide prose describing how the reviewer should *think*. Use it for
  anything unscopable (a rule about findings themselves) or carrying no useful severity.
- **`config.json`'s `rules[]`** — a scoped, positive detector with an `id`, a `rule`
  phrased "Flag the PR when …", a `severity`, and a `scope` array of globs. Use it when
  the rule names a condition a specific set of paths can be checked against.

Writing a section:

1. Open with the fact or cost that justifies the rule — its *why* — then the imperative.
   Every section follows this shape; one that opens on the instruction reads as an
   assertion the reviewer can dismiss.
2. Say what to do when the rule's test *passes*, not only when it fails. A one-directional
   suppression rule teaches the reviewer to drop findings it should have written.
3. Place it by kind: stance sections lead, noise-suppression sections group together, and
   **`Where the rules live` stays the closer**.

Keep it short. Every section spends the budget the file's own `Priority order` section
allocates, so a rule that changes no verdict dilutes the ones that do.

Use the `/doc-coauthoring` skill for substantive prose passes.

Maintenance: this doc is a node on the documentation map. Keep
[`documentation-rules.md`](../documentation-rules.md) in sync per its maintenance rule.
