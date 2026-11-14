# What `caret install` adds

*Audience: people who use caret and want to know why it works as it does.*

`caret install` connects caret to each [agent host](../reference/glossary.md#agent-host)
you pick, sets up the [background service](../reference/glossary.md#background-service) if
you keep it running, and fetches the
[plan formatter](../reference/glossary.md#plan-formatter) (see
[Plan formatting](plan-formatting.md)). The steps are in
[Install caret](../how-to/install.md); this page says what each one changes.

## Which agent hosts it picks

caret looks for each agent host it supports:

- Claude Code, when `claude` is on your PATH.
- OpenCode, when `opencode` is on your PATH or an OpenCode config folder exists.
- pi, when `pi` is on your PATH.

At a terminal, it asks which to install into, with the ones it found already selected. Off
a terminal, as in CI or a pipe, it doesn't ask: it installs into every agent host it
found, or into Claude Code when it found none, and says which. `--dry-run` shows that
choice without changing anything.

`--uninstall` doesn't ask either. It removes caret from every agent host, and the
background service with it. All your agent hosts share that one service, so `--uninstall`
can't remove caret from just one of them.

At a terminal, the install shows a step for each change it makes. Piped, in CI, or with
color off (`NO_COLOR`, `TERM=dumb`, or `--no-color`), it prints plain `caret: …` lines
instead.

## Claude Code

caret reaches Claude Code as the `caret@caret` plugin, from the `macintacos/caret`
marketplace. The plugin adds:

- Hooks that open the [review page](../reference/glossary.md#review-page) when Claude
    Code asks to leave plan mode, its planning mode that doesn't edit files.
- A hook that starts the background service when Claude Code enters plan mode, so the
    review opens without waiting.
- A hook that asks the model to open its plan with a `# title` line, which caret shows
    as the review's title.
- A hook that marks a plan you approved in Claude Code's own dialog as approved in caret
    too.
- A band above the prompt while a plan waits for you.
- The `review_plan` [review tool](../reference/glossary.md#review-tool), which a skill
    can call to show you a plan outside plan mode (see
    [Calling the review tool from your own skill](https://github.com/macintacos/caret/blob/main/docs/ARCHITECTURE.md#calling-the-review-tool-from-your-own-skill)).

Every `caret install` run updates the plugin, with or without `--refresh`. Restart Claude
Code to load the new version. To update by hand, run `claude plugin update caret@caret`,
or in Claude Code run `/plugin marketplace update caret` then `/reload-plugins`.

If one of Claude Code's settings files declares a `caret` marketplace that points
somewhere other than `macintacos/caret`, Claude Code keeps that one, and the install warns
you, naming its source.

For what removing caret leaves behind, see
[Remove caret](../how-to/install.md#remove-caret).

## OpenCode

caret reaches OpenCode as a plugin. The install adds `@macintacos/caret` to the plugin
array in your OpenCode config: `plugins` when every `opencode` on your PATH is v2, else
`plugin`, which every version loads. It writes `opencode.jsonc` or `opencode.json` in the
config folder and keeps your comments. It removes caret's entry from your other global
config files, so OpenCode loads caret once. You can add the array entry by hand instead.

The install also:

- Adds the [`/caret` command](../reference/glossary.md#caret-command) file and the three
    references it loads under `caret/` in your OpenCode config folder.
- Removes the plugin and `caret:*.md` command files older caret versions added. OpenCode
    still loads those, so a leftover would give the agent a second review tool.
- Leaves the config folder's `package.json` alone, since it may belong to another
    plugin.

On its next start, OpenCode installs caret into its own cache (see
[Install caret § OpenCode](../how-to/install.md#opencode)). The plugin then adds:

- The `caret_review_plan` review tool, and a nudge to the `plan` agent to call it.
- **Approve & build** on OpenCode v2, which approves and switches the session to the
    `build` agent.
- A start of the background service on each message to the `plan` agent.
- A pop-up notice (a toast) with the review page's link, on v1 and v2.
- On v2 only, the `caret.open` key (`<leader>p`) and a line above the prompt while a
    plan waits.
- A toast when a newer caret is out. Set `CARET_OPENCODE_NO_UPDATE_CHECK` to turn it off
    (see [Environment variables](../reference/environment-variables.md)).

On v2, the toasts, the key, and the line come from caret's terminal-UI half, so they need
OpenCode's terminal UI; the web and desktop apps show none of them.

`caret doctor`'s `opencode-host` check flags an OpenCode too old for caret, and caret
listed where your OpenCode won't load it. An OpenCode v1 older than 1.3.4 fails to load
the plugin. For supported versions, see
[OpenCode versions](../reference/platform-support.md#opencode-versions).

### When OpenCode loads an old caret

`caret install --refresh` makes OpenCode load the newest caret. It clears a stale cached
copy so OpenCode fetches caret again on its next start, or, when you pinned an old
version, moves the pin to the newest. A plain `caret install` checks the same thing and
asks first at a terminal. Restart OpenCode afterward to load the new caret. Until you do,
the background service you keep running doesn't fall back to OpenCode's old copy: it runs
the copy of caret the install keeps under `~/.local/state/caret/roots/<version>/` (see
[Which caret it runs](background-service.md#which-caret-it-runs)).

To choose the version yourself, pin `"@macintacos/caret@<version>"` in the plugin array
and change the pin when you want another.

To clear the cache by hand on v1, run:

```sh
rm -rf ~/.cache/opencode/packages/@macintacos/caret*
```

On v2, which stores an unpinned entry as `@latest` and keeps older installs beside the
current one, run:

```sh
rm -rf ~/.cache/opencode/npm/@macintacos/caret@*
```

!!! note "Keep the *"

    OpenCode makes one cache folder per entry, so an unpinned `@macintacos/caret` and each
    pinned `@macintacos/caret@<version>` get folders of their own. Without the `*`, the
    pinned folders stay, and OpenCode loads the old copy from one of them.

## pi

caret reaches pi as an extension in the `@macintacos/caret` package, which the install
adds with `pi install`. The extension adds:

- The `caret_review_plan` review tool. It waits for your decision, up to
    `review.timeout_s`, and `esc` cancels the review. If caret fails, the tool tells the
    agent the review failed, not that you asked for changes.
- A planning mode, `/caret <description>`, since pi has none of its own.
- A notice and a `caret` footer status while a plan waits. `ctrl+alt+o` opens its review
    page in your browser.
- `/caret demo`, which shows the [demo plan](../reference/glossary.md#demo-plan), and
    `/caret doctor`, which checks your install.

`CARET_PI_BIN` changes which caret the extension runs (see
[Environment variables](../reference/environment-variables.md)).

caret needs pi 1.5.0 or later. It changes pi only through pi's own package commands, and
never writes pi's `settings.json`. A plain install adds `npm:@macintacos/caret`, or
updates it when it's there. It leaves a pinned entry alone;
`pi install npm:@macintacos/caret` unpins it. `--uninstall` removes every caret entry.

`caret doctor` has three pi checks. They flag:

- A pi that is missing or older than 1.5.0.
- caret listed more than once, filtered out of pi's package list, or listed without its
    package.
- A caret older than the latest release.

The install and `caret doctor` honor `PI_CODING_AGENT_DIR`, but the installed background
service looks only in `~/.pi/agent`. If you set it, the background service won't find the
caret you installed for pi.

By hand:

- `pi install npm:@macintacos/caret` installs caret.
- `pi update npm:@macintacos/caret` updates it. A bare `pi update` updates pi itself.
- `pi remove npm:@macintacos/caret` removes it.

For what pi needs to run caret, see [Install caret § pi](../how-to/install.md#pi).
