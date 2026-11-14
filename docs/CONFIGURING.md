# caret — Configuring

*Audience: users and contributors tuning caret — the supported platforms, the config file,
the `CARET_*` environment variables, and plan formatting.*

Part of the deep reference behind [README.md](../README.md). For what caret is, how to
install it, and basic usage, start there.

## Plan formatting (rumdl)

caret canonicalizes every incoming plan by reflowing it to a 90-column MD013 shape with
[rumdl](https://github.com/rvben/rumdl). Link URLs are exempt from that measurement —
nothing can break inside a URL, so counting it would only fragment the prose around it —
which means a line carrying a link runs wider than 90 and scrolls in the plan reader.

rumdl is not a runtime prerequisite: caret installs the pinned binary (v0.3.2) into
`$XDG_STATE_HOME/caret/rumdl/` and verifies its checksum, so formatting behaves the same
however caret was installed (Claude plugin or OpenCode).

> [!IMPORTANT]
> caret only ever formats with that one binary, at that one path. A `rumdl` on your `PATH`
> is never used: which version reflows your plans must not depend on what the machine
> happens to have installed.

How that plays out:

- **Reuse is version-pinned.** The binary already at caret's path is reused only when it
  reports exactly the pinned version; an older copy left by a previous caret, or a file
  that won't run, is replaced.
- **Install warms it; the first plan is the fallback.** `caret install` runs that check at
  install time so the first plan doesn't pay the download, and a failure there is a
  warning rather than a failed install — a later plan retries.
- **A failed acquisition backs off for ten minutes.** Retrying every plan would re-fetch
  several megabytes on the path that creates your review and fail again anyway, so a
  failed download suppresses the next attempt for ten minutes; plans submitted inside that
  window are stored unformatted. Fix the cause (connectivity, a rate limit) and the next
  attempt after the window succeeds — or run `caret install` to retry immediately.
- **Formatting never loses a plan.** If a plan can't be formatted (rumdl missing, offline,
  an unsupported platform, or formatting outran its two-second budget), caret stores it
  unchanged and logs one warning.
- **`CARET_RUMDL_BIN` opts out of the download, not the pin.** Point it at a rumdl of your
  own and caret uses that instead of downloading — but only when it reports the pinned
  version too; anything else falls back to the download.
