# Show caret in the menu bar

*Audience: anyone on macOS who wants to see at a glance whether a plan is waiting.*

caret's menubar app puts a carrot in the macOS menu bar. The carrot colours in while a
plan waits for review and is grey otherwise, including when no caret is running. When it
changes, it fades from one to the other in under a fifth of a second. It doesn't fade when
the app starts. With **Reduce motion** on in System Settings > Accessibility, it changes
at once.

Its menu has two items:

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

The question's default is **Yes** when the app is already installed, and **No** otherwise.
`caret install` does not ask under `--dry-run` or `--uninstall`.

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
