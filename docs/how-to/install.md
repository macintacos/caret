# Install caret

*Audience: anyone installing, updating, or removing caret on macOS or Linux.*

This page covers installing, updating, and removing caret for Claude Code, OpenCode, and
pi. It also covers running caret yourself instead of having it start at login.

## Before you install

You need:

- macOS or Linux. Windows is best-effort and runs caret on demand only; see
  [Platform support](https://github.com/macintacos/caret/blob/main/docs/CONFIGURING.md#platform-support)
  for what differs.
- [`bun`](https://bun.sh) on your PATH.
- At least one [agent host](../reference/glossary.md#agent-host) at its minimum version:
  - Claude Code, any version.
  - OpenCode v1 1.3.4 or later, or v2 2.0.29 or later.
  - pi 1.5.0 or later.

## Install

Run:

```sh
bunx --no-cache @macintacos/caret@latest install
```

The command adds caret to each agent host it finds on your machine. It also installs the
[plan formatter](../reference/glossary.md#plan-formatter).

It then asks how to run the
[background service](../reference/glossary.md#background-service):

- **Keep it running** (recommended): the background service starts at login.
- **I'll run it myself**: you start it by hand when you want it. See
  [Run caret yourself](#run-caret-yourself).

While the background service runs, the [review page](../reference/glossary.md#review-page)
is at <http://caret.localhost:42718>.

## Finish setting up your agent host

Each agent host needs a restart before it picks caret up. In every agent host,
`/caret demo` shows the [demo plan](../reference/glossary.md#demo-plan) and
`/caret doctor` checks your install.

### Claude Code

The install adds caret through the `claude` command: the `macintacos/caret` marketplace
and the `caret@caret` plugin. If `claude` is not on your PATH, run this inside Claude Code
instead:

```text
/plugin marketplace add macintacos/caret
/plugin install caret@caret
```

Restart Claude Code. Claude Code lists the
[`/caret` command](../reference/glossary.md#caret-command) as `caret:caret`, and typing
`/caret` runs it.

New to caret? Follow [Review your first plan](../tutorial/first-plan.md).

### OpenCode

Restart OpenCode. It installs the caret plugin on its next start, so `bun` must be on the
PATH that OpenCode runs with.

`/caret …` runs on OpenCode's `plan` agent, so switch to `build` once you approve. On
OpenCode v2, `ctrl+x p` (`<leader>p`) opens the plan waiting in the session. To change
that key, rebind `caret.open` under OpenCode's `keybinds`.

New to caret? Follow [Review your first plan](../tutorial/first-plan.md).

### pi

The install needs `pi` and `bun` on your PATH. caret installs into pi's user scope only
and ignores a project-scope install (`pi install -l`).

Run `/reload` in pi, or restart it. pi has no planning mode of its own, so caret adds one:

1. `/caret <what you want done>` turns on planning mode. The agent writes its plan into
   `~/.pi/agent/plans`, and caret blocks its `edit` and `write` tools outside that folder
   until you approve.
2. While a plan waits, a notice shows above the editor and the footer reads
   `^ plan waiting`. Press `ctrl+alt+o` to open the plan in your browser. In Terminal.app
   or iTerm2, set Option to act as Meta for that key to reach pi.
3. Press Esc in pi to cancel a waiting review.

New to caret? Follow [Review your first plan](../tutorial/first-plan.md).

## Run caret yourself

To keep caret from starting at login, run the install and answer **I'll run it myself**.
That removes the background service if one is registered.

Then, whenever you want the review page up, run:

```sh
bunx --no-cache @macintacos/caret@latest serve
```

The review page stays up at <http://caret.localhost:42718> until you stop the command with
Ctrl+C. To go back to starting at login, run the install again and answer
**Keep it running**.

To turn caret off entirely, see
[Turning caret off](https://github.com/macintacos/caret/blob/main/docs/RUNNING.md#turning-caret-off).

## Update caret

Run:

```sh
bunx --no-cache @macintacos/caret@latest install --refresh
```

The command installs the newest caret into every agent host without asking which ones. It
asks the background-service question again, then restarts the background service if you
keep it running.

caret checks for a newer version once a day. When one is out, the review page shows:

- a notice that opens **What's new**;
- a mark on the settings button;
- **Settings → Updates**, which names the version and the command to take it.

To turn the check off, use that same pane. Or set this in `~/.config/caret/config.toml`,
as
[the `[updates]` table](https://github.com/macintacos/caret/blob/main/docs/CONFIGURING.md#the-updates-table)
describes:

```toml
[updates]
check = false
```

## Remove caret

Run:

```sh
bunx --no-cache @macintacos/caret@latest install --uninstall
```

The command removes caret from every agent host, along with the background service, the
launcher, and the installed versions under `~/.local/state/caret/roots/`. It keeps your
reviews.

In Claude Code, it uninstalls the `caret@caret` plugin but leaves the `macintacos/caret`
marketplace registered.

## Next steps

- Review a plan from start to finish in
  [Review your first plan](../tutorial/first-plan.md).
- Change caret's settings with
  [`CONFIGURING.md`](https://github.com/macintacos/caret/blob/main/docs/CONFIGURING.md).
- Open the review page from another device with
  [Reaching caret from another device](https://github.com/macintacos/caret/blob/main/docs/RUNNING.md#reaching-caret-from-another-device).
- See what the install changes in each agent host in
  [Installing with `caret install`](https://github.com/macintacos/caret/blob/main/docs/ARCHITECTURE.md#installing-with-caret-install).
