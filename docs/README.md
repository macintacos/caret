# caret — Documentation

*Audience: users and contributors looking something up in caret's `docs/` directory.*

Find the row that matches what you came here to do, then follow the link.

| What you want to do | Where it is |
| --- | --- |
| See what caret does | [the docs home](index.md) |
| Install caret | [Install caret](how-to/install.md) |
| Run caret yourself, instead of having it start at login | [Install caret § Run caret yourself](how-to/install.md#run-caret-yourself) |
| See which platforms caret supports, and what differs on each | [`CONFIGURING.md` § Platform support](CONFIGURING.md#platform-support) |
| Change the daemon port, the review timeout, or the log level in `config.toml` | [`CONFIGURING.md` § Config file](CONFIGURING.md#config-file) |
| Look up a `CARET_*` environment variable | [`CONFIGURING.md` § Environment variables](CONFIGURING.md#environment-variables) |
| Understand how caret reformats a plan before you read it | [`CONFIGURING.md` § Plan formatting (rumdl)](CONFIGURING.md#plan-formatting-rumdl) |
| Write or check a theme file | [`CONFIGURING.md` § Theme files](CONFIGURING.md#theme-files) |
| Turn on desktop notifications, or work out why none appear | [Get notified about plans § Turn on desktop notifications](how-to/notifications.md#turn-on-desktop-notifications) |
| Turn caret's sounds off | [Get notified about plans § Turn the sound off or down](how-to/notifications.md#turn-the-sound-off-or-down) |
| Switch a plan between its source and a rendered preview | [Read a plan § Switch between the preview and the source view](how-to/read-a-plan.md#switch-between-the-preview-and-the-source-view) |
| Tell which plans arrived while you were reading another one | [Get notified about plans § Find plans you have not read](how-to/notifications.md#find-plans-you-have-not-read) |
| Clear a cmux pane's unread mark from a review | [Get notified about plans § Clear cmux unread marks](how-to/notifications.md#clear-cmux-unread-marks) |
| Find out what the mark on the settings button means, or stop update notices | [Install caret § When an update is out](how-to/install.md#when-an-update-is-out) |
| Open the review UI from another device, or log every device out | [`RUNNING.md` § Reaching caret from another device](RUNNING.md#reaching-caret-from-another-device) |
| Have an agent on another computer send its plans to the server's caret | [`RUNNING.md` § Reviewing on the server from another device](RUNNING.md#reviewing-on-the-server-from-another-device) |
| Stop caret starting with your machine, or remove it | [`RUNNING.md` § Turning caret off](RUNNING.md#turning-caret-off) |
| Find the logs, or scrub them before sharing | [`RUNNING.md` § Logging & Debugging](RUNNING.md#logging--debugging) |
| Work out why caret isn't working, or gather a report to share | [`RUNNING.md` § Diagnostics](RUNNING.md#diagnostics) |
| Understand how caret works, and how it hooks into your agent | [`ARCHITECTURE.md` § How it works](ARCHITECTURE.md#how-it-works) |
| Call the review tool from a skill of your own | [`ARCHITECTURE.md` § Calling the review tool from your own skill](ARCHITECTURE.md#calling-the-review-tool-from-your-own-skill) |
| Find where something lives in the source tree | [`ARCHITECTURE.md` § Layout](ARCHITECTURE.md#layout) |
| Set up a local checkout for the first time, or find where tests live | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
| Build caret from source | [`DEVELOPMENT.md` § Build from source](DEVELOPMENT.md#build-from-source) |
| Run a dev instance, or look up any task in the full `mise` catalog | [`DEVELOPMENT.md` § Development](DEVELOPMENT.md#development) |
| Add or change a `mise` task | [`DEVELOPMENT.md` § The tasks CLI](DEVELOPMENT.md#the-tasks-cli) |
| Cut a release, or redo the npm publishing setup | [`DEVELOPMENT.md` § Releasing](DEVELOPMENT.md#releasing) |
| Refresh the README's screenshot | [`DEVELOPMENT.md` § Regenerating the README assets](DEVELOPMENT.md#regenerating-the-readme-assets) |
| Work out which of caret's three rumdl roles you're touching, or bump its version | [`agents/rumdl-rules.md`](agents/rumdl-rules.md) |
| Follow the conventions for the area of code you're changing | [`agents/`](agents/), routed by [`AGENTS.md`](../AGENTS.md) |
| Match caret's design direction: how it looks, moves, sounds, and prints | [`design/`](../design/README.md) |

## `agents/`

caret's contributor rules-of-the-road: one file per area of the code, and the substance
behind the router in the repo's [`AGENTS.md`](../AGENTS.md) — that file decides *which* of
these a given change should pull into context; these files are what it pulls.

Writing docs rather than code? The same idea for prose lives in
[`agents/documentation-rules.md`](agents/documentation-rules.md): it maps every doc caret
ships — this router, the top-level README, the four reference pages, `CONTRIBUTING.md`,
and the `agents/` rule files — and decides which one a given change should update.

Adding a new rule-of-the-road? Drop it in `agents/` as its own file, add a route to it
from the router in `AGENTS.md`, and update the doc map in
[`agents/documentation-rules.md`](agents/documentation-rules.md) — see that file's
maintenance rule.
