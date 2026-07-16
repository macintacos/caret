# Add a `--quiet` flag to the release script

## Context

The release script prints every step it runs, which buries the one line that matters — the
published version. A `--quiet` flag would suppress the play-by-play and print only the
final result.

## Approach

Thread a `quiet` boolean from the CLI arg parser down to the logger, and gate the
step-by-step lines behind it. The final summary always prints.

## Steps

1. Parse `--quiet` in the arg handler and default it to `false`.
2. Pass the flag into the logger; skip `info`-level lines when it is set.
3. Keep the closing "published vX.Y.Z" line unconditional.
