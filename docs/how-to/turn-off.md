# Turn caret off

*Audience: anyone who wants caret to stop starting at login, or to remove it.*

Two commands turn off different amounts of caret:

| Command | What it does |
| --- | --- |
| `caret install`, answering **I'll run it myself** | Stops caret starting at login. Your agent still reaches caret, which starts on demand. |
| `caret install --uninstall` | Removes caret from every [agent host](../reference/glossary.md#agent-host), and from this machine. |

## Stop caret starting at login

Run `caret install` and answer **I'll run it myself**. That removes the
[background service](../reference/glossary.md#background-service) `caret install` set up,
so the [review page](../reference/glossary.md#review-page) is no longer up from login
onward. The install then prints how to bring the review page up by hand: `caret serve`
keeps it up until you stop it with `ctrl+c` (see
[Run caret yourself](install.md#run-caret-yourself)).

The choice isn't saved anywhere, so a later `caret install` at a terminal asks again.
Without a terminal, `caret install` can't ask, so it leaves things as they are: it
refreshes the service if one is registered, and adds none otherwise.

## Remove caret

Run the command in [Remove caret](install.md#remove-caret).

Besides removing caret from the agent hosts, `--uninstall` removes the service's unit
file, the [launcher](../explanation/background-service.md#which-caret-it-runs) that starts
it, the records the launcher reads, and caret's own copies under
`~/.local/state/caret/roots/`. It keeps your reviews. The launcher removes the same things
itself once it finds no caret installed anywhere, its own copies included.

`--uninstall` also removes the [menubar app](menubar.md) and the macOS file that starts it
at login. When the launcher cleans up on its own, it keeps the menubar app.

To remove only the menubar app, run `caret install` and answer **No** to its question (see
[Show caret in the menu bar](menubar.md#remove-the-app)).

## If macOS Login Items shows caret

!!! warning

    On macOS caret also appears under **System Settings → Login Items**. Turning it off
    there does not turn caret off for `caret install`, because caret cannot read that
    switch. A later `caret install` that keeps caret running registers the service again
    and reports success while the switch still reads off. Turn caret off with
    `caret install`, answering **I'll run it myself**, or with `--uninstall` instead.

## Next steps

- Bring the review page up by hand with
    [Run caret yourself](install.md#run-caret-yourself).
- Check or restart the service with [Run the background service](background-service.md).
