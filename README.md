# 🥕 `caret`

`caret` works with your agent host: Claude Code, OpenCode, or pi. It replaces the host's
plan-approval prompt with a review page in your browser. When the agent presents a plan,
you read it there, comment on the lines that matter, then approve it or request changes.
caret sends your feedback back to the agent.

One background service serves every session, so you review several plans from one browser
tab.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/caret-review-ui-dark.png">
  <img src="docs/assets/caret-review-ui-light.png" alt="caret's review UI: a plan with two inline comments, the file it cites open in a preview, and the comment list open">
</picture>

## Install

It needs [`bun`](https://bun.sh) on your PATH, and macOS or Linux.

```sh
bunx --no-cache @macintacos/caret@latest install
```

Then follow the [tutorial](https://macintacos.github.io/caret/tutorial/first-plan/) to
review your first plan. The [docs site](https://macintacos.github.io/caret/) covers every
agent host, updating, and removing caret.

Want to develop `caret` rather than use it? Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## Diagnostics

- `/caret doctor` runs `caret doctor`: a one-shot, read-only check of your install —
  what's wrong, how to fix it, and the state it read that from. Always redacted, and it
  never contains plan, prompt, or feedback bodies, nor any log message, error or stack
  text.
- `caret doctor --bundle` archives the raw logs and review records when a maintainer needs
  them. That archive is **not** redacted, so caret asks before writing it.

## License

MIT — see [LICENSE](LICENSE). Vendored third-party code and assets are itemized, with
their licenses, in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
