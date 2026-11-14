# Plan formatting

*Audience: people who use caret and want to know why it works as it does.*

caret rewraps every plan to 90 columns before you see it, so every plan reads the same
whichever [agent host](../reference/glossary.md#agent-host) sent it. Line numbers on the
[review page](../reference/glossary.md#review-page) count lines of that formatted plan;
[Call the review tool from your own skill](../how-to/review-tool.md#wait-for-the-decision)
covers what the agent receives.

## Why some lines run wider

caret does not count a link's URL toward the 90 columns. Nothing can break inside a URL,
so counting it would only chop up the words around it. A line that carries a link can
therefore run wider than 90 columns and scroll sideways on the review page.

## The formatter caret uses

caret formats plans with [rumdl](https://github.com/rvben/rumdl), its
[plan formatter](../reference/glossary.md#plan-formatter). You do not install rumdl
yourself: caret downloads its own copy, pinned to v0.3.2, into
`~/.local/state/caret/rumdl/` and checks its checksum. Formatting behaves the same however
you installed caret.

!!! note

    caret never uses a `rumdl` on your PATH, so which version rewraps your plans does not
    depend on what your machine has installed.

How that plays out:

- **caret keeps its copy only at the pinned version.** caret reuses its copy only when
    it reports exactly the pinned version. caret replaces an older copy left by a previous
    caret, or a file that won't run.
- **`caret install` downloads it ahead of time.** Your first plan then does not wait for
    the download. If that fails, the install still succeeds with a warning, and a later
    plan retries.
- **After a failed download, caret waits ten minutes before retrying.** Retrying on
    every plan would download several megabytes while caret creates your review, and
    likely fail again. Plans sent in those ten minutes are shown unformatted. Fix the
    cause (your connection, a rate limit) and caret tries again on the first plan after
    the ten minutes, or run `caret install` to retry now.
- **Formatting never loses a plan.** If a plan can't be formatted (no formatter,
    offline, an unsupported platform, or formatting took longer than two seconds), caret
    keeps it unchanged and logs one warning.

To use a rumdl of your own instead of the download, set `CARET_RUMDL_BIN` (see
[Environment variables](../reference/environment-variables.md)). caret uses it only when
it reports the pinned version; otherwise caret downloads its own copy as usual.
