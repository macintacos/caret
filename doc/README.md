# caret — Documentation

*Audience: users and contributors looking something up in caret's `doc/` directory.*

Find the row that matches what you came here to do, then follow the link.

| What you want to do | Where it is |
| --- | --- |
| Install caret, or see what it does | [top-level `README.md`](../README.md) |
| See which platforms caret supports, and what differs on each | [`CONFIGURING.md` § Platform support](CONFIGURING.md#platform-support) |
| Change the daemon port, the review timeout, or the log level in `config.toml` | [`CONFIGURING.md` § Config file](CONFIGURING.md#config-file) |
| Look up a `CARET_*` environment variable | [`CONFIGURING.md` § Environment variables](CONFIGURING.md#environment-variables) |
| Understand how caret reformats a plan before you read it | [`CONFIGURING.md` § Plan formatting (rumdl)](CONFIGURING.md#plan-formatting-rumdl) |
| Turn on desktop notifications, or work out why none appear | [`RUNNING.md` § Desktop notifications](RUNNING.md#desktop-notifications) |
| Clear a cmux pane's unread mark from a review | [`RUNNING.md` § cmux unread marks](RUNNING.md#cmux-unread-marks) |
| Find the logs, or scrub them before sharing | [`RUNNING.md` § Logging & Debugging](RUNNING.md#logging--debugging) |
| Understand how caret works, and how it hooks into your agent | [`ARCHITECTURE.md` § How it works](ARCHITECTURE.md#how-it-works) |
| Call the review tool from a skill of your own | [`ARCHITECTURE.md` § Calling the review tool from your own skill](ARCHITECTURE.md#calling-the-review-tool-from-your-own-skill) |
| Find where something lives in the source tree | [`ARCHITECTURE.md` § Layout](ARCHITECTURE.md#layout) |
| Set up a local checkout for the first time, or find where tests live | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
| Build caret from source | [`DEVELOPMENT.md` § Build from source](DEVELOPMENT.md#build-from-source) |
| Run a dev instance, or look up any task in the full `mise` catalog | [`DEVELOPMENT.md` § Development](DEVELOPMENT.md#development) |
| Add or change a `mise` task | [`DEVELOPMENT.md` § The tasks CLI](DEVELOPMENT.md#the-tasks-cli) |
| Refresh the README's screenshot and demo recording | [`DEVELOPMENT.md` § Regenerating the README assets](DEVELOPMENT.md#regenerating-the-readme-assets) |
| Follow the conventions for the area of code you're changing | [`agents/`](agents/), routed by [`CLAUDE.md`](../CLAUDE.md) |

## `agents/`

caret's contributor rules-of-the-road: one file per area of the code, and the substance
behind the routing digraph in the repo's [`CLAUDE.md`](../CLAUDE.md) — that file decides
*which* of these a given change should pull into context; these files are what it pulls.

Writing docs rather than code? The same idea for prose lives in
[`agents/documentation-rules.md`](agents/documentation-rules.md): it maps every doc caret
ships — this router, the top-level README, the four reference pages, `CONTRIBUTING.md`,
and the `agents/` rule files — and decides which one a given change should update.

Adding a new rule-of-the-road? Drop it in `agents/` as its own file, add a route to it
from the digraph in `CLAUDE.md`, and update the doc map in
[`agents/documentation-rules.md`](agents/documentation-rules.md) — see that file's
maintenance rule.
