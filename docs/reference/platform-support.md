# Platform support

*Audience: anyone running caret who wants to know what works on their operating system or
agent host version.*

caret supports macOS and Linux. Windows is best-effort.

## Operating systems

| Platform | [Background service](glossary.md#background-service) | Opens the [review page](glossary.md#review-page) with | [Plan formatter](glossary.md#plan-formatter) |
| --- | --- | --- | --- |
| macOS | launchd agent `dev.excessive.caret`, started at login | `open` | arm64 and x86_64 |
| Linux | systemd user unit `caret.service`. Needs a systemd user session; lingering (`loginctl enable-linger`) keeps it running past logout | `xdg-open` | arm64 and x86_64 |
| Windows | none: caret runs on demand | `cmd /c start` | none: plans show unformatted |

`caret doctor` lists processes with the BSD-style `ps -axo pid=,comm=` on every platform.

!!! note

    On Linux or Windows, if the browser doesn't open or `caret doctor` shows no processes,
    use the review URL caret prints to stderr instead.

## Agent host versions

| Agent host | Version caret needs |
| --- | --- |
| Claude Code | No minimum that caret checks. The plan-waiting band needs 2.1.287 or later. |
| OpenCode v1 | 1.3.4 or later. An older v1 fails to load caret. |
| OpenCode v2 | 2.0.29 or later. An older v2 loads caret, but caret can't take the plan as a file there, so the agent passes the plan text instead. |
| pi | 1.5.0 or later. On an older pi, caret's review tool is off. |

`caret doctor` flags an OpenCode or pi older than these. For what caret adds to each agent
host, see [What `caret install` adds](../explanation/caret-install.md).
