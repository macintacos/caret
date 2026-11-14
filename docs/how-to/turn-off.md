# Turn caret off

*Audience: anyone who wants caret to stop starting at login, or to remove it.*

This page covers the two ways to turn caret off: stopping it starting at login, and
removing it from every [agent host](../reference/glossary.md#agent-host) and from your
machine.

## Stop caret starting at login

Two commands turn caret off, and they turn off different amounts of it:

| Command | What it does |
| --- | --- |
| `caret install`, answering **I'll run it myself** | Stops caret starting at login: the [review page](../reference/glossary.md#review-page) is no longer up from login onward. Your agent still reaches caret, and caret starts on demand. |
| `caret install --uninstall` | Removes caret from every agent host, and from this machine. |

Answering **I'll run it myself** removes the
[background service](../reference/glossary.md#background-service) `caret install` set up.
The install then prints how to bring the review page up by hand: `caret serve` keeps it up
until you stop it with `ctrl+c` (see [Run caret yourself](install.md#run-caret-yourself)).

The choice isn't saved anywhere. A later `caret install` at a terminal asks again. When
`caret install` runs without a terminal, it can't ask, so it leaves things as they are: it
refreshes the service if one is registered, and adds none otherwise.

## Remove caret

Run the command in [Remove caret](install.md#remove-caret).

Alongside the agent hosts, `--uninstall` removes the service's unit file, the
[launcher](background-service.md#upgrade-the-background-service) that starts it, and the
records the launcher reads, and caret's own copy under `~/.local/state/caret/roots/`. It
keeps your reviews.

The launcher removes the same things itself when it finds no caret anywhere (its own copy
counts), after looking twice more, five seconds apart. When caret is installed but can't
run, it stops the service instead (see
[Fix a background service that keeps stopping](background-service.md#fix-a-background-service-that-keeps-stopping)).
Either way, `caret install` brings caret back.

## If macOS Login Items shows caret

!!! warning

    On macOS caret also appears under **System Settings › Login Items**, but that switch
    is neither `caret install` nor `--uninstall`. caret cannot read it, so a later
    `caret install` that keeps caret running registers the service again and reports
    success while the switch still reads off. Run `caret install` and answer
    **I'll run it myself**, or use `--uninstall`, instead.

## Next steps

- Bring the review page up by hand with
    [Run caret yourself](install.md#run-caret-yourself).
- Check or restart the service with [Run the background service](background-service.md).
