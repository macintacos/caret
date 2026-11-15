# Install caret

*Audience: anyone installing, updating, or removing caret on macOS or Linux.*

## Before you install

You need:

- macOS or Linux. Windows is best-effort and runs caret on demand only; see
    [Platform support](../reference/platform-support.md) for what differs.
- [`bun`](https://bun.sh) on your PATH.
- At least one [agent host](../reference/glossary.md#agent-host) at its minimum version:
    Claude Code at any version, OpenCode v1 1.3.4 or v2 2.0.29 or later, or pi 1.5.0 or
    later.

## Install

1. Run:

    ```sh
    bunx --no-cache @macintacos/caret@latest install
    ```

2. Pick the agent hosts to add caret to. The ones the command found are already selected.
3. Pick how to run the [background service](../reference/glossary.md#background-service):

    - **Keep it running** (recommended): the background service starts at login.
    - **I'll run it myself**: you start it by hand when you want it. Without it, caret
        still starts when your agent sends a plan. See
        [Run caret yourself](#run-caret-yourself).

4. On macOS 13 or later, answer whether to show caret in the menu bar. See
    [Show caret in the menu bar](menubar.md).

The command also installs the [plan formatter](../reference/glossary.md#plan-formatter).
While the background service runs, the [review page](../reference/glossary.md#review-page)
is at <http://caret.localhost:42718>.

At a terminal, the install shows a step for each change it makes. Piped, in CI, or with
color off (`NO_COLOR`, `TERM=dumb`, or `--no-color`), it prints plain `caret: …` lines
instead.

Other pages write caret's commands as `caret <command>`, such as `caret doctor`. If
`caret` is not on your PATH, run `bunx --no-cache @macintacos/caret@latest <command>`
instead.

## Finish setting up your agent host

Restart each agent host so it picks caret up. In every agent host, `/caret demo` shows the
[demo plan](../reference/glossary.md#demo-plan) and `/caret doctor` checks your install.

### Claude Code

The install adds caret through the `claude` command: it registers the `macintacos/caret`
marketplace and installs the `caret@caret` plugin. If `claude` is not on your PATH, the
install stops before it sets up the plan formatter and the background service. Install
Claude Code's `claude` command and run the install again, or:

1. Add the plugin inside Claude Code:

    ```text
    /plugin marketplace add macintacos/caret
    /plugin install caret@caret
    ```

2. Run the install again with Claude Code unselected, so it finishes setting up.

Restart Claude Code. It lists the
[`/caret` command](../reference/glossary.md#caret-command) as `caret:caret`, and typing
`/caret` runs it.

New to caret? Follow [Review your first plan](../tutorial/first-plan.md).

### OpenCode

Restart OpenCode. It installs the caret plugin on its next start, so `bun` must be on the
PATH OpenCode runs with.

`/caret …` runs on OpenCode's `plan` agent, its planning mode that doesn't edit files. On
OpenCode v1, switch to the `build` agent, its editing mode, once you approve. On v2, the
**Approve & build** option switches for you.

On OpenCode v2, `ctrl+x p` (`<leader>p`) opens the plan waiting in the session. To change
that key, rebind `caret.open` under OpenCode's `keybinds`.

Run `/caret demo` to try the review page. From
[Read the plan](../tutorial/first-plan.md#read-the-plan) on, the tutorial applies as
written.

### pi

The install needs `pi` and `bun` on your PATH. caret installs into pi's user scope only
and ignores a project-scope install (`pi install -l`).

Run `/reload` in pi, or restart it. pi has no planning mode of its own, so caret adds one:

1. Run `/caret <what you want done>` to turn planning mode on. The agent writes its plan
    into `~/.pi/agent/plans`, and caret blocks its `edit` and `write` tools outside that
    folder until you approve. Shell commands are discouraged while planning, not blocked.
    `/caret plan` on its own turns planning mode off.
2. While a plan waits, a notice shows above the editor and the footer reads
    `^ plan waiting`. Press `ctrl+alt+o` to open the plan in your browser. In Terminal.app
    or iTerm2, set Option to act as Meta so that key reaches pi.
3. Approve, and the agent implements the plan. Request changes, and it revises the plan
    and presents it again. To cancel a waiting review, press `esc` in pi; the agent is
    told not to implement the plan.

Run `/caret demo` to try the review page. From
[Read the plan](../tutorial/first-plan.md#read-the-plan) on, the tutorial applies as
written.

## Run caret yourself

To keep caret from starting at login:

1. Run the install and answer **I'll run it myself**. That removes the background service
    if one is registered. caret still starts when your agent sends a plan.
2. Whenever you want the review page up, run:

    ```sh
    bunx --no-cache @macintacos/caret@latest serve
    ```

    The review page stays up at <http://caret.localhost:42718> until you stop the command
    with `ctrl+c`.

To go back to starting at login, run the install again and answer **Keep it running**. To
turn caret off entirely, see [Turn caret off](turn-off.md).

## Update caret

Run:

```sh
bunx --no-cache @macintacos/caret@latest install --refresh
```

The command asks the same questions as the install. It then takes the newest caret in each
agent host you pick, replacing a cached or pinned OpenCode copy without asking. If you
keep the background service running, the command restarts it. Restart each agent host
afterward so it loads the new caret.

To update one agent host by hand:

- Claude Code: run `claude plugin update caret@caret`, or in Claude Code run
    `/plugin marketplace update caret` then `/reload-plugins`.
- OpenCode: see
    [When OpenCode loads an old caret](../explanation/caret-install.md#when-opencode-loads-an-old-caret).
- pi: run `pi update npm:@macintacos/caret`. A bare `pi update` updates pi itself.

### When an update is out

caret checks for a newer version about once a day. When one is out, the review page shows
a notice naming it the next time you open or reload the page. The notice stays until you
read or dismiss it. Each version gets one notice, so a newer release gets its own.

**What's new** on the notice opens a dialog listing what changed since your version: the
release notes for each release you skipped, or, on a caret you built from a clone of its
repository, the commits on caret's main branch since your build. Its footer links the full
comparison on GitHub and repeats the upgrade command. The dialog contacts GitHub only when
it opens. The [Changelog](../changelog.md) lists every release's notes.

After you upgrade, the first page load opens the dialog by itself, with the notes for each
release since the version this browser last saw. Closing it marks the new version seen;
until then, a reload opens it again. The first time you open caret in a browser, caret
records the version without opening the dialog. With update checks off, the dialog stays
shut.

While an update waits, a small mark sits on the settings button and on the **Updates** row
in **Settings**, so you can find the update after you dismiss the notice.

**Settings → Updates** shows the version you run, the version available, and the command
that installs it, matched to how this caret was installed. caret has no update button: you
run the command yourself. While an update waits, a **What's new** button in the pane opens
the same dialog.

These messages in the pane are not errors:

- **Nothing to compare against.** This caret was built from a commit that is not on
    caret's main branch, so GitHub has nothing to compare it to.
- **Update checks are off for dev builds.** caret runs straight from a clone of its
    repository.
- **Update checks are off.** You turned the checks off.

### Turn update checks off

Turn off the **Check for updates** switch in **Settings → Updates**. It takes effect at
once: the notice and both marks go away. Turning it back on checks right away, unless
caret already checked in the last day, and shows the answer the next time you open or
reload the review page.

Or set this in `~/.config/caret/config.toml`, as
[the `[updates]` table](../reference/config-file.md#the-updates-table) describes:

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
[menubar app](menubar.md), and the copies of caret it installed under
`~/.local/state/caret/`. It keeps your settings and your reviews.

In Claude Code, it uninstalls the `caret@caret` plugin but leaves the `macintacos/caret`
marketplace registered. To remove that too, run `claude plugin marketplace remove caret`.

To remove caret from pi alone, run `pi remove npm:@macintacos/caret`.

## Next steps

- Review a plan from start to finish in
    [Review your first plan](../tutorial/first-plan.md).
- Change caret's settings in the [config file](../reference/config-file.md).
- Open the review page from another device with
    [Open caret from another device](remote-access.md).
- See what the install changes in each agent host in
    [What `caret install` adds](../explanation/caret-install.md).
