# Maintaining `CHANGELOG.md`

*Audience: coding agents and contributors touching the changelog.*

`CHANGELOG.md` is keep-a-changelog release history. It is
**owned by the `/release-caret` flow**, which authors each release's entry under a themed
release name as part of cutting a version — it is not hand-edited mid-feature. A normal
feature PR does **not** add a changelog entry; the release flow does, at release time.

When to touch it:

- Through `/release-caret` when cutting a release, or to correct a factual error in an
  already-published entry.
- rumdl lints the changelog (`MD024` is configured `siblings-only` so the repeated
  `### Added` / `### Changed` / `### Fixed` headings across version sections pass) — keep
  the keep-a-changelog structure intact.

Maintenance: this doc is a node on the documentation map. If its shape changes, update
[`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
