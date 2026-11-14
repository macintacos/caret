# Platform support

*Audience: anyone running caret who wants to know what works on their operating system and
agent host.*

caret supports macOS and Linux. Windows is best-effort. What differs between them is the
[background service](glossary.md#background-service) that keeps the review page up, and
the command caret uses to open a review in your browser.

## Operating systems

| Platform | Background service | Opens the review page with |
| --- | --- | --- |
| macOS | launchd agent `dev.excessive.caret`, started at login | `open` |
| Linux | systemd user unit `caret.service`. Needs a systemd user session; lingering (`loginctl enable-linger`) keeps it running past logout | `xdg-open` |
| Windows | none — caret runs on demand | `cmd /c start` |

`caret doctor` lists processes with the BSD-style `ps -axo pid=,comm=` on every platform.

!!! note

    On Linux or Windows, if the browser doesn't open or `caret doctor` shows no processes,
    use the review URL caret prints to stderr instead.

## OpenCode versions

caret supports OpenCode v1 1.3.4 or later and v2 2.0.29 or later. An older v2 still loads
caret but refuses every `path` review, so the agent passes the plan inline instead.
[The OpenCode adapter](https://github.com/macintacos/caret/blob/main/docs/ARCHITECTURE.md#the-opencode-adapter)
has the detail, including the `caret doctor` check that flags an older v1 or v2.
