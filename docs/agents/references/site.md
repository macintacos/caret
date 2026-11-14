# Editing the docs site

*Audience: coding agents and contributors adding or editing a page on caret's docs site.*

The docs site is a [zensical](https://zensical.org/) site built from `docs/` by
`zensical.toml`. `.github/workflows/docs.yml` deploys it to
https://macintacos.github.io/caret/ on each `v*` release tag or a manual run, so the live
site lags `main` between releases.

Where a page goes:

- Put it in its Diátaxis section's directory: `docs/tutorial/`, `docs/how-to/`,
  `docs/reference/`, or `docs/explanation/`.
- Add its nav entry in `zensical.toml` under that section, after the section's `index.md`.
  A page with no nav entry is unreachable from the site's menu.
- Never reorder the four sections.

What stays off the site: a repo-only page, such as `docs/agents/`, `docs/README.md`, or
the four reference pages, is listed in `zensical.toml`'s `exclude_docs`. Leaving a page
out of `nav` is not enough, because zensical still builds it and indexes it for search.

Links:

- Link between site pages with a relative path, such as `../how-to/index.md`.
- Link to an excluded page with its GitHub URL. `docs:build` runs zensical with
  `--strict`, which fails a relative link to an excluded page as if the page were missing.

Checking:

- `mise run docs:build` fails on a broken link, a broken anchor, or a nav entry that names
  a missing or excluded page.
- `mise run docs:serve` previews the site at http://localhost:2273/caret/.

Use the `/doc-coauthoring` skill for any substantive prose pass — it keeps the page
on-audience and scannable.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
