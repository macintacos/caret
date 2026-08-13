# Add a `--quiet` flag to the release script

## Context

The release script prints every step it runs, which buries the one line that matters — the
published version. On a green run that is roughly sixty lines of play-by-play for a single
piece of information, and in CI it is sixty lines nobody reads until something breaks.

A `--quiet` flag would suppress the play-by-play and print only the final result. The
failure path stays exactly as it is: when a step exits non-zero its output is what tells
you why, so quiet mode still lets it through.

## Approach

Thread a `quiet` boolean from the CLI arg parser down to the logger, and gate the
step-by-step lines behind it. The logger already separates `info` from `warn` and `error`,
so the flag only has to change what `info` does — no call site has to learn about it.

The summary line stays unconditional. It is the reason the script gets run at all, and a
mode that hid it would be a mode nobody reaches for.

## Steps

1. Parse `--quiet` in the arg handler and default it to `false`.
2. Pass the flag into the logger; skip `info`-level lines when it is set.
3. Keep the closing "published vX.Y.Z" line unconditional.
4. Leave `warn` and `error` alone, so a failing step still explains itself.

## Verification

Run the release script against a scratch tag in both modes and compare the line counts:

```sh
./release.sh --dry-run | wc -l          # ~60 lines today
./release.sh --dry-run --quiet | wc -l  # 1 line
```

Then force a step to fail and confirm the error still reaches the terminal under
`--quiet`, since that is the case the flag must not silence.

## Risks

The flag is additive and defaults off, so every existing invocation behaves exactly as it
does today. The one thing to watch is a caller that greps the play-by-play for a step
name; `--quiet` would break it, which is why nothing sets the flag by default.
