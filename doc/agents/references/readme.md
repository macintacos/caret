# Editing `README.md`

*Audience: coding agents and contributors editing caret's top-level README.*

`README.md` is the lean, user-facing front door and the project's front page. It leads
with the install/usage audience and stays focused — what caret is, install, basic usage,
and pointers onward. The advanced and contributor-facing depth lives in the `doc/`
reference pages — [`CONFIGURING.md`](../../CONFIGURING.md),
[`RUNNING.md`](../../RUNNING.md), [`ARCHITECTURE.md`](../../ARCHITECTURE.md), and
[`DEVELOPMENT.md`](../../DEVELOPMENT.md) — which the README links to directly or reaches
through [`doc/README.md`](../../README.md); when content gets deep, it lands there, not
here.

When to edit it:

- A user-visible change to the front door: a new or changed install path, a new top-level
  command, basic-usage behavior, or a pointer that needs updating. Deep configuration,
  architecture, and dev-workflow detail belong in the matching `doc/` reference page — and
  new `config.toml` / `CARET_*` rows land in [`CONFIGURING.md`](../../CONFIGURING.md)'s
  tables (see [`settings-rules.md`](../settings-rules.md)).
- Route human-onboarding basics to `CONTRIBUTING.md` rather than duplicating them here.

Use the `/doc-coauthoring` skill for any substantive prose pass — it keeps the section
on-audience and scannable.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
