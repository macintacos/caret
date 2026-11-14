# How caret works

*Audience: people who use caret and want to know why it works as it does.*

Every plan makes the same round trip: from your
[agent host](../reference/glossary.md#agent-host) to caret, to you on the
[review page](../reference/glossary.md#review-page), and back to the agent as its answer.
By default, the whole trip stays on your own machine. To reach it from another device, see
[Open caret from another device](../how-to/remote-access.md).

## The round trip

1. Your agent finishes a plan and hands it to caret.
2. caret formats the plan (see [Plan formatting](plan-formatting.md)).
3. The [background service](../reference/glossary.md#background-service) holds the plan,
    and caret opens the review page in your browser.
4. You [approve](../reference/glossary.md#approve) the plan,
    [request changes](../reference/glossary.md#request-changes), or
    [reject](../reference/glossary.md#reject) it.
5. caret sends your decision and your [feedback](../reference/glossary.md#feedback) back
    to the agent.
6. If you asked for changes, the agent's revised plan arrives as a new
    [version](../reference/glossary.md#version) of the same review.

!!! warning "caret never approves a plan you haven't reviewed"

    When something goes wrong, caret turns the plan down and tells the agent why. That
    holds for a plan caret can't read, a background service caret can't reach, a review
    that times out, and caret being stopped mid-review.

## One caret, every agent host

caret's review works the same whichever agent host you use. caret adds a small plugin to
each agent host (an extension in pi). The plugin hands caret the plan and gives the agent
your decision in the form that agent host expects. See
[What `caret install` adds](caret-install.md).

## Why a review times out

In every agent host, caret waits for your decision for up to `review.timeout_s`, one hour
by default (see
[The `[daemon]` and `[review]` tables](../reference/config-file.md#the-daemon-and-review-tables)),
then turns the plan down. The limit exists because of Claude Code, which ends the wait
itself after 3900 seconds and lets the plan through unreviewed, so caret must answer
first. For a longer window, raise `review.timeout_s` to anything under 3900 seconds; caret
rejects a higher value.
