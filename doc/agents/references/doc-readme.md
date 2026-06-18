# Editing `doc/README.md`

*Audience: coding agents and contributors editing the `doc/` directory index.*

`doc/README.md` is the index of the `doc/` directory: it says what documentation lives
here (today, the `agents/` rules-of-the-road and this routing layer) and why. It is
delineated from the top-level `README.md`, which is the user-facing guide — this one is an
index of `doc/`, not a guide.

When to edit it:

- The contents or shape of `doc/` change — a new subdirectory, a new kind of doc, a moved
  file.

Keep it an index: link onward rather than duplicating content. It already points at
`agents/documentation-rules.md` as the doc map.

Use the `/doc-coauthoring` skill for substantive prose passes.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
