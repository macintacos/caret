# Show caret in the menu bar

*Audience: anyone on macOS who wants to see at a glance whether a plan is waiting.*

caret's menubar app puts a carrot in the macOS menu bar. The carrot colours in while a
plan waits for review and is grey otherwise, including when no caret is running. When it
changes, it fades from one to the other in under a fifth of a second. It doesn't fade when
the app starts. With **Reduce motion** on in **System Settings → Accessibility**, it
changes at once.

Its menu opens on a card of your review stats (see
[Read your review stats](#read-your-review-stats)), then two items:

- **Open caret** opens the [review page](../reference/glossary.md#review-page).
- **Quit** closes the app.

The app needs macOS 13 or later. It runs with or without the
[background service](../reference/glossary.md#background-service).

## Add the app

Run `caret install` at a terminal. On macOS 13 or later, it asks:

```text
Show caret in the menu bar?
```

Answer **Yes** to add the app. It opens right away and starts at login. If it crashes,
macOS starts it again. If you choose **Quit**, it stays closed until your next login.

The question's default is **Yes**. `caret install` does not ask under `--dry-run` or
`--uninstall`.

## Keep the app current

The app reads caret's port and address from your [settings](../reference/config-file.md)
when `caret install` runs. After you change either, run `caret install` again so the app
finds caret.

The app reaches caret only through this Mac's own address (`127.0.0.1` or `localhost`). It
still works with [`[daemon] host`](../reference/config-file.md) set to all addresses
(`0.0.0.0` or `::`). With `host` set to one specific address other than this Mac's own,
`caret install` warns and does not install or update the app. To use the app, set `host`
back and run `caret install` again.

When `caret install` runs from a script or another tool instead of at a terminal, it
cannot ask. If the app is installed, it updates it; otherwise it leaves the app out. An
update does not reopen an app you quit, so it stays closed until your next login.

An [agent host](../reference/glossary.md#agent-host) that updates caret on its own leaves
the app at its old version. Run `caret install` to update it.

## Read your review stats

The card at the top of the menu shows the version of caret that is running, and four
counts over every [review](../reference/glossary.md#review) you have done on this Mac:

- **plans approved**: the plans you approved.
- **plans rejected**: the plan versions you turned down with **Reject**. A Reject stays
    counted when the agent later sends another plan. A plan you send back with
    **Request changes** is not counted here; the version the agent sends next counts as a
    revision.
- **revisions**: every version of a plan after its first.
- **comments**: the inline comments and the
    [general comment](../reference/glossary.md#feedback) on versions you approved or sent
    back with **Request changes**. A Reject sends no comments, so comments drafted on a
    rejected version don't count, and nor do drafts on a plan still waiting.

The app asks caret for these as you open the menu. When no caret is running, or the
running caret is too old to report stats, each count shows a dash and the version is the
app's own. Run `caret install` to update an old caret. When caret answers with an error,
the card says **caret didn't answer the app** (see
[Fix an app that misbehaves](#fix-an-app-that-misbehaves)).

The `^` and a faint tint on the card take the accent of the themes you chose in the review
page's **Settings → Appearance**: your light theme's in light mode, and your dark theme's
in dark mode. Until you open the review page, the card uses caret's own amber. With
**Reduce transparency** on in **System Settings → Accessibility**, the card is solid, and
with **Increase contrast** on, its edge is drawn stronger.

## Where it lives

- The app: `~/.local/state/caret/menubar/` (under `$XDG_STATE_HOME/caret` when you set
    `XDG_STATE_HOME`).
- The LaunchAgent, the macOS file that starts the app at login:
    `~/Library/LaunchAgents/dev.excessive.caret.menubar.plist`.
- Its error log: `logs/menubar-stderr.log` in the same state directory (see
    [Find the log files](logs.md#find-the-log-files)).

## Fix an app that misbehaves

If the carrot never appears or keeps vanishing, read `logs/menubar-stderr.log`. It holds
the app's errors and any crash output.

If the card says **caret didn't answer the app**, a caret is running but refused the app's
request, most often because the app holds an old copy of caret's address or token. Run
`caret install` again to refresh them.

If the carrot shows but never colours in, the app records each change of its icon in the
macOS log. To read the last hour of it:

```bash
log show --last 1h --predicate 'subsystem == "dev.excessive.caret.menubar"'
```

## Remove the app

Run `caret install` and answer **No**. That removes the app and its LaunchAgent and keeps
the rest of caret.

To remove all of caret, the app included, run `caret install --uninstall` (see
[Remove caret](install.md#remove-caret)).
