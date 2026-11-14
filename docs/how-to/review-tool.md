# Call the review tool from your own skill

*Audience: anyone writing a skill that should get a human decision on its plan before the
work proceeds.*

This page covers calling caret's [review tool](../reference/glossary.md#review-tool)
directly from a skill, rather than waiting for caret to intercept a plan: finding the tool
in your [agent host](../reference/glossary.md#agent-host), passing the plan, handling the
decision, and how each host differs.

## Find the tool in your agent host

Claude Code, OpenCode, and pi each have a review tool:

| Agent host  | Tool                | Where it comes from                  |
| ----------- | ------------------- | ------------------------------------ |
| Claude Code | `review_plan`       | The plugin's MCP server, `caret mcp` |
| OpenCode    | `caret_review_plan` | The in-process plugin                |
| pi          | `caret_review_plan` | The pi extension                     |

Claude Code prefixes a plugin's MCP tools with the plugin and server names, so the model
sees `review_plan` as `mcp__plugin_caret_caret__review_plan`.

## Pass the plan

Claude Code's tool takes a single argument, `plan`: the complete plan, as markdown, to put
in front of the reviewer. OpenCode's tool takes exactly one of `plan` or `path`, and
`path` is preferred. `path` names a markdown (`.md`) file holding the complete plan,
either absolute or relative to the session's directory. pi's tool takes the same `plan` or
`path`, `path` preferred, and strips a leading `@` from `path`.

Pass nothing else: the review's session and working directory come from the calling
session (OpenCode, pi) or from the MCP server (Claude Code). caret titles the review from
the plan's first `#` heading (else its first `##`, else its opening line), so open the
plan with `# <title>`.

## Send only plans

caret reflows whatever it receives into its own plan layout and presents it as a plan, so
a checklist, a schema, or a question put through it arrives looking like something it
isn't. The tool's name and description are the only steer the model gets, and both tell
the model to send only plans.

## Wait for the decision

The call blocks until the reviewer decides. When the reviewer chooses
[request changes](../reference/glossary.md#request-changes), the tool result carries their
[feedback](../reference/glossary.md#feedback), plus an instruction to revise and call
again and not to implement anything until a call returns an approval. The plan itself is
not echoed back: the agent still holds it, in its own tool-call arguments or in its file.

A feedback line reference indexes the plan version caret stored, and an abbreviated quote
rides with it only when the agent may not hold that version line for line. That stored
[version](../reference/glossary.md#version) is reflowed to caret's 90-column shape by the
[plan formatter](../reference/glossary.md#plan-formatter) (see
[Plan formatting](https://github.com/macintacos/caret/blob/main/docs/CONFIGURING.md#plan-formatting-rumdl)),
so the line numbers are caret's, not yours, and the quote is what to match against your
own text. A plan sent by `path` is the exception: caret writes the reflowed text back onto
the file, so the numbers match once the agent re-reads it, and no quote is sent.

So the loop is: call, read the feedback, revise, call again, until an approval returns.
When the reviewer chooses [approve](../reference/glossary.md#approve), the approval may
carry their notes in a clearly labeled section, to fold in as the work proceeds. Don't
call again; the plan is approved.

## Revise a plan file in place

With `path`, the loop runs on the file instead of regenerating the plan. Write the plan
once. On a change request, re-read the file, make targeted edits, and call again with the
same `path`. On approval there is nothing left to save: the file already holds the
approved plan, with any reviewer notes appended unless you rewrote the file after caret
read it. The notes still come back in the tool result too.

Because caret rewrites the file, it first checks OpenCode's edit permission on it. On
OpenCode v1, and on v2 from 2.0.29, it asks, and a denied ask comes back as an error with
no review. An older v2 gives a plugin no way to ask, so caret refuses every `path` review
there with an error naming 2.0.29, whatever the rules allow.

OpenCode's `plan` agent may edit plan files only in a few places, so caret's planning
steer tells it to write to OpenCode's plans directory: on v1
`~/.local/share/opencode/plans` (under `$XDG_DATA_HOME` when that is set), on v2
`~/.opencode/plan`, or wherever `[opencode] plans_dir` in caret's
[config file](../reference/config-file.md#the-opencode-table) points. Any other agent can
use any `.md` file its edit rules allow. On v2 a file outside the project hits
`external_directory`, which defaults to `ask`, so OpenCode asks the user.

## When the review fails

A failure never approves a plan. A spawn failure, an unparseable decision, or a timeout
(`review.timeout_s`, 1 hour by default; see [Config file](../reference/config-file.md))
all come back as a change request in Claude Code and OpenCode. A deny caret made itself
carries `failsafe: true` on caret's own wire format, and pi reports it as a failed review
instead.

Cancelling a pending call on Claude Code (`esc`), or quitting Claude Code, expires its
review undecided: it leaves the review page's pending list rather than waiting out the
timeout, and no agent is waiting on its result.

## Who may call it

### OpenCode

Any primary agent may call it; subagents may not. On v1, where OpenCode doesn't fire
plugin hooks for subagent tool calls, caret marks the review tool primary-only through
`experimental.primary_tools`, which OpenCode turns into a deny rule on every subagent
session; on v2 it removes the tool from every subagent request. Either way it re-checks in
the tool body that the call didn't come from a subagent's child session.

Only the Plan agent is steered toward the tool; every other primary agent has to reach for
it deliberately. On v1 the permission rescue is a `plan`-agent permission, so a global
deny-all keeps the tool there and loses it everywhere else. On v2 it is a rule on each
plan session, a default `plan` agent's included, which stays with the session if it
switches agent. If your skill is pinned to a non-plan agent, `caret_review_plan` is the
route: OpenCode's own `plan_exit` is permitted on the `plan` agent alone, so there is
nothing to fall back on.

### Claude Code

Any agent may call it, subagents included. The tool grants no permission and gates no
edit, so there is nothing a subagent could bypass by calling it.

### pi

Any session may call it. Only the steers of `/caret <description>` and `/caret demo` tell
the model to use it. Otherwise the model sees just the tool's schema and its entry in pi's
tool list.

## What differs in Claude Code

A long wait has two wrinkles. From Claude Code v2.1.212 a tool call still running after
two minutes can move to the background; the tool's description tells the model not to act
on the plan until the result arrives. And the plugin gives the server a request timeout of
`3900000` ms, the same 3900 s budget as the `ExitPlanMode` hook, which sits above the
highest `review.timeout_s` caret accepts (it must stay below 3900 s), so caret's own
timeout always answers first.

Three more behaviors follow from how the server is built:

- **One review at a time.** The server derives its session id when it starts (Claude
    Code's session id with an `mcp-` prefix, or a fresh uuid when Claude Code gives none)
    and uses it for every call for the life of the Claude Code process. A second review
    under that id would land as the next version of the pending one and end the first call
    with a deny, so the server refuses a call made while a review is pending: it returns
    an error at once, telling the agent to wait for the pending decision.
- **Resubmissions thread.** Because every call from that process shares the one id, a
    revised plan sent after a change request lands as the next version of the same review.
    The prefix keeps the id from ever equalling a hook's session id, so a tool review and
    a review intercepted from plan mode (`ExitPlanMode`) never replace each other; the
    plan-waiting band uses the id to find the tool review. The one oddity: after `/clear`,
    a submission can still land as a new version of a review from before the clear that
    was waiting on changes, and the band cannot find the tool review, so it links the
    review page instead.
- **Approve is always plain.** A tool result cannot change Claude Code's permission
    mode, so choosing accept-edits or auto when approving a tool-submitted plan approves
    it without switching modes.

## Next steps

- [Config file](../reference/config-file.md) sets `review.timeout_s` and
  `[opencode] plans_dir`.
- The [glossary](../reference/glossary.md) defines the terms this page uses.
