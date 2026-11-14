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

The review works the same whichever agent host you use, because caret adds a small plugin
to each one (an extension in pi). The plugin hands caret the plan and gives the agent your
decision in the form that agent host expects. See
[What `caret install` adds](caret-install.md).

## Why a review times out

In every agent host, caret waits up to `review.timeout_s` for your decision, one hour by
default (see
[The `[daemon]` and `[review]` tables](../reference/config-file.md#the-daemon-and-review-tables)),
then turns the plan down. The limit comes from Claude Code, which stops waiting on caret
after 3900 seconds and then handles the plan itself, outside your review in caret. caret
must answer first, so it rejects a `review.timeout_s` of 3900 or more. For a longer
window, raise it to anything below that.

## The review tool

A skill can call caret's [review tool](../reference/glossary.md#review-tool) to put its
plan in front of you outside plan mode (see
[Call the review tool from your own skill](../how-to/review-tool.md)). In two agent hosts,
how caret serves that tool shapes the reviews it makes.

### In Claude Code, revisions join one review

Claude Code reaches the review tool through caret's MCP server, `caret mcp`, which Claude
Code starts from the caret plugin. The server derives one session id when it starts:
Claude Code's session id with an `mcp-` prefix, or a fresh uuid when Claude Code gives
none. It uses that id for every call while the Claude Code process runs. So a revised plan
sent after a change request lands as the next [version](../reference/glossary.md#version)
of the same review.

The prefix keeps the id from ever equalling the session id caret's plan-mode hooks use, so
a tool review and a review intercepted from plan mode (`ExitPlanMode`) never replace each
other. The plan-waiting band, the line above Claude Code's prompt while a plan waits, uses
the id to find the tool review.

One exception: after `/clear`, a submission can still land as a new version of a review
from before the clear that was waiting on changes. The band then cannot find the tool
review, so it links the review page instead.

### In OpenCode, only primary agents call it

caret keeps subagents off the review tool in two layers:

- On v1, OpenCode doesn't fire plugin hooks for subagent tool calls. So caret marks the
    review tool primary-only through `experimental.primary_tools`, which OpenCode turns
    into a deny rule on every subagent session. On v2, caret removes the tool from every
    subagent request.
- On both, the tool body re-checks that the call didn't come from the child session
    OpenCode opens for a subagent.

caret also allows the tool past a deny-all permission config, for planning only:

- On v1, that allow is a `plan`-agent permission. A global deny-all keeps the tool on
    the `plan` agent and removes it everywhere else.
- On v2, it is a rule on each plan session, a default `plan` agent's included. The rule
    stays with the session if the session switches agent.
