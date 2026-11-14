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
- A new section directory also needs a line in `.rumdl.toml`'s `[per-file-flavor]` table
  setting it to `mkdocs`.
- A section's `index.md` introduces the section. It does not list the section's pages.

What stays off the site: a repo-only page, such as `docs/agents/`, `docs/README.md`,
`docs/ARCHITECTURE.md`, or `docs/DEVELOPMENT.md`, is listed in `zensical.toml`'s
`exclude_docs`. Leaving a page out of `nav` is not enough, because zensical still builds
it and indexes it for search.

When a change updates a page:

- A new or changed `config.toml` key adds its row to `docs/reference/config-file.md`, and
  a `CARET_*` variable adds its row to `docs/reference/environment-variables.md`, in the
  same change, per [`settings-rules.md`](../settings-rules.md). A `[dev]` key, or a
  dev-only or preflight-only variable, goes in `docs/DEVELOPMENT.md` § Dev and preflight
  settings instead.
- A theme-format change (fields, roles, validation, how caret loads theme files) goes in
  `docs/reference/theme-files.md` with its schema change.
- A plan-formatting change (the pinned rumdl version, the reflow shape, the opt-out) goes
  in `docs/explanation/plan-formatting.md`. [`rumdl-rules.md`](../rumdl-rules.md) says
  how.
- Runtime behaviour a user sees (notifications, cmux unread marks, what a log record
  carries, a diagnostics subcommand) goes in the matching how-to page. Logging conventions
  for contributors belong in [`logging-rules.md`](../logging-rules.md).

Writing a page:

- Lead with the action (a how-to) or the point (an explanation), not the mechanism.
- Write "caret" in lowercase in prose. Write keys as lowercase code spans: `ctrl+alt+o`,
  `esc`.
- Name a setting as "the **<label>** switch in **Settings → <pane>**". Check the label
  against `ui/src/lib/settingsRegistry.ts`.
- Use the [glossary](../../reference/glossary.md)'s terms, and link each one on its first
  use on a page. Write "background service", not "daemon" or "caret service", and "review
  page", not "review UI", except inside a code span that names a config key. "Background
  service" covers the installed login service, `caret serve`, and an on-demand instance;
  name which one wherever the difference matters.

Markdown the site renders:

- Use `!!! note` and `!!! warning` admonitions with a 4-space-indented body. Never use
  GitHub's `> [!NOTE]`, which the site renders as a plain quote.
- On site pages, indent every list continuation (a wrapped line, a second paragraph, a
  code block) 4 spaces. `rumdl`'s MD077 enforces it.
- Nest a list only under a numbered item, 4 spaces in. Never nest a bullet under a bullet:
  `rumdl`'s MD007 re-indents the child to 2 spaces, which the site renders flat. Split it
  into separate lists instead.

Links:

- Link between site pages with a relative path, such as `../how-to/index.md`.
- Link to an excluded page with its GitHub URL. `docs:build` runs zensical with
  `--strict`, which fails a relative link to an excluded page as if the page were missing.

Pages a test reads:

Each page below is listed in `MARKDOWN_READ_BY_TESTS` in `scripts/preflight.ts`, so a
Markdown-only change to it still runs the unit tests. When you add a test that reads a
site page, add the page to `MARKDOWN_READ_BY_TESTS`.

- `docs/how-to/review-tool.md`: `test/structure/line-anchor-claim.test.ts` requires the
  sentence beginning "A feedback line reference indexes…" verbatim and exactly once,
  matching `ui/src/lib/feedback.ts` and `bridge/review-bridge.ts`. Reword all three or
  none, and keep emphasis and links out of it.
- `docs/explanation/caret-install.md` prints exactly one `rm -rf` per OpenCode cache
  layout. `test/adapters/opencode/docs-cache-path.test.ts` asserts each against
  `opencodeCachePackageDir()` / `opencodeNpmCacheDir()`, so don't add or drop one.
- `docs/reference/theme-files.md`: `test/core/theme/schema.test.ts` parses its § Example
  theme file and its § `syntax` role tables against the schema.
- `docs/reference/built-in-themes.md`: `test/core/theme/load.test.ts` checks it lists
  exactly the built-in theme ids.

Checking:

- `mise run docs:build` fails on a broken link, a broken anchor, or a nav entry that names
  a missing or excluded page.
- `mise run docs:serve` previews the site at http://localhost:2273/caret/.

Use the `/doc-coauthoring` skill for any substantive prose pass — it keeps the page
on-audience and scannable.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
