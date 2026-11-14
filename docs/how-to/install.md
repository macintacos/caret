# Install caret

*Audience: anyone installing, updating, or removing caret on macOS or Linux.*

This page covers installing, updating, and removing caret for Claude Code, OpenCode, and
pi. It also covers running caret yourself instead of having it start at login.

## Before you install

You need:

- macOS or Linux. Windows is best-effort and runs caret on demand only; see
  [Platform support](../reference/platform-support.md) for what differs.
- [`bun`](https://bun.sh) on your PATH.
- At least one [agent host](../reference/glossary.md#agent-host) at its minimum version,
  listed below.

Agent host minimums:

- Claude Code.
- OpenCode v1 1.3.4 or later, or v2 2.0.29 or later.
- pi 1.5.0 or later.

## Install

Run:

```sh
bunx --no-cache @macintacos/caret@latest install
```

The command asks which agent hosts to add caret to, with the ones it found already
selected. It also installs the [plan formatter](../reference/glossary.md#plan-formatter).

It then asks how to run the
[background service](../reference/glossary.md#background-service):

- **Keep it running** (recommended): the background service starts at login.
- **I'll run it myself**: you start it by hand when you want it. Without it, caret still
  starts when your agent sends a plan. See [Run caret yourself](#run-caret-yourself).

While the background service runs, the [review page](../reference/glossary.md#review-page)
is at <http://caret.localhost:42718>.

## Finish setting up your agent host

Each agent host needs a restart before it picks caret up. In every agent host,
`/caret demo` shows the [demo plan](../reference/glossary.md#demo-plan) and
`/caret doctor` checks your install.

### Claude Code

The install adds caret through the `claude` command: the `macintacos/caret` marketplace
and the `caret@caret` plugin. If `claude` is not on your PATH, the install stops before it
sets up the plan formatter and the background service. Either install Claude Code's
`claude` command and run the install again, or add the plugin inside Claude Code:

```text
/plugin marketplace add macintacos/caret
/plugin install caret@caret
```

Then run the install again with Claude Code unselected, so it finishes setting up.

Restart Claude Code. Claude Code lists the
[`/caret` command](../reference/glossary.md#caret-command) as `caret:caret`, and typing
`/caret` runs it.

New to caret? Follow [Review your first plan](../tutorial/first-plan.md).

### OpenCode

Restart OpenCode. It installs the caret plugin on its next start, so `bun` must be on the
PATH that OpenCode runs with.

`/caret …` runs on OpenCode's `plan` agent, its planning mode that doesn't edit files. On
OpenCode v1, switch to `build` once you approve. On v2, the **Approve & build** option
switches for you. On OpenCode v2, `ctrl+x p` (`<leader>p`) opens the plan waiting in the
session. To change that key, rebind `caret.open` under OpenCode's `keybinds`.

Run `/caret demo` to try the review page. From
[Read the plan](../tutorial/first-plan.md#read-the-plan) on, the tutorial applies as
written.

### pi

The install needs `pi` and `bun` on your PATH. caret installs into pi's user scope only
and ignores a project-scope install (`pi install -l`).

Run `/reload` in pi, or restart it. pi has no planning mode of its own, so caret adds one:

1. `/caret <what you want done>` turns on planning mode. The agent writes its plan into
   `~/.pi/agent/plans`, and caret blocks its `edit` and `write` tools outside that folder
   until you approve. Shell commands are only discouraged while planning, not blocked.
   `/caret plan` on its own turns planning mode off.
2. While a plan waits, a notice shows above the editor and the footer reads
   `^ plan waiting`. Press `ctrl+alt+o` to open the plan in your browser. In Terminal.app
   or iTerm2, set Option to act as Meta for that key to reach pi.
3. Approve, and the agent implements the plan. Request changes, and it revises the plan
   and presents it again. Press Esc in pi to cancel a waiting review; the agent is told
   not to implement the plan.

Run `/caret demo` to try the review page. From
[Read the plan](../tutorial/first-plan.md#read-the-plan) on, the tutorial applies as
written.

## Run caret yourself

To keep caret from starting at login, run the install and answer **I'll run it myself**.
That removes the background service if one is registered. caret still starts when your
agent sends a plan.

Then, whenever you want the review page up, run:

```sh
bunx --no-cache @macintacos/caret@latest serve
```

The review page stays up at <http://caret.localhost:42718> until you stop the command with
Ctrl+C. To go back to starting at login, run the install again and answer
**Keep it running**.

To turn caret off entirely, see
[Turn caret off](turn-off.md).

## Update caret

Run:

```sh
bunx --no-cache @macintacos/caret@latest install --refresh
```

The command asks the same two questions as the install. It then takes the newest caret in
each agent host you pick, without asking whether to replace a cached or pinned OpenCode
copy, and restarts the background service if you keep it running.

### When an update is out

caret checks for a newer version about once a day. When one is out, the review page shows
a notice the next time you open or reload it. The notice names the version. It stays until
you read or dismiss it. It appears once per version, so a newer release gets its own
notice.

**What's new** on the notice opens a dialog listing what changed since your version. On an
installed caret, it shows the release notes for each release you skipped. On a caret you
built from a clone of its repository, it shows the commits on caret's main branch since
your build. Its footer links the full comparison on GitHub and repeats the upgrade
command. The dialog contacts GitHub only when it opens.

After you upgrade, the first page load opens the dialog by itself, with the notes for each
release since the version this browser last saw. Closing it marks the new version seen;
until then, a reload opens it again. The first time you open caret in a browser, caret
records the version without opening the dialog. With update checks off, the dialog stays
shut.

While an update waits, a small mark sits on the settings button and on the **Updates** row
in **Settings**, so you can find the update again after you dismiss the notice.

**Settings → Updates** shows the version you run, the version available, and the exact
command that installs it. The command matches how this caret was installed. caret has no
update button: you run the command yourself. While an update waits, a **What's new**
button in the pane opens the same dialog.

The pane can show two messages that are not errors:

- **Nothing to compare against.** A caret built from a commit that is not on caret's
    main branch has nothing for GitHub to compare it to.
- **Update checks are off.** Either caret runs straight from a clone of its repository,
    or you turned the checks off.

### Turn update checks off

Turn off the **Check for updates** switch in **Settings → Updates**. It takes effect at
once: the notice and both marks go away. Turning it back on checks right away, unless
caret already checked in the last day, and shows the answer the next time you open or
reload the review page.

Or set this in `~/.config/caret/config.toml`, as
[the `[updates]` table](../reference/config-file.md#the-updates-table)
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

The command removes caret from every agent host, along with the background service and the
copies of caret it installed under `~/.local/state/caret/`. It keeps your settings and
your reviews.

In Claude Code, it uninstalls the `caret@caret` plugin but leaves the `macintacos/caret`
marketplace registered.

## Next steps

- Review a plan from start to finish in
  [Review your first plan](../tutorial/first-plan.md).
- Change caret's settings in the [config file](../reference/config-file.md).
- Open the review page from another device with
  [Open caret from another device](remote-access.md).
- See what the install changes in each agent host in
  [Installing with `caret install`](https://github.com/macintacos/caret/blob/main/docs/ARCHITECTURE.md#installing-with-caret-install).
