# Call the review tool from your own skill

*Audience: anyone writing a skill that should get a human decision on its plan before the
work proceeds.*

Call caret's [review tool](../reference/glossary.md#review-tool) from your skill to put
its plan in front of a reviewer, rather than waiting for caret to intercept a plan.

## Find the tool in your agent host

Each [agent host](../reference/glossary.md#agent-host) has a review tool:

| Agent host  | Tool                | Where it comes from                  |
| ----------- | ------------------- | ------------------------------------ |
| Claude Code | `review_plan`       | The plugin's MCP server, `caret mcp` |
| OpenCode    | `caret_review_plan` | The in-process plugin                |
| pi          | `caret_review_plan` | The pi extension                     |

Claude Code prefixes a plugin's MCP tools with the plugin and server names, so the model
sees `review_plan` as `mcp__plugin_caret_caret__review_plan`.

## Pass the plan

| Agent host  | Arguments |
| ----------- | --------- |
| Claude Code | `plan` only: the complete plan, as Markdown, to put in front of the reviewer. |
| OpenCode    | Exactly one of `plan` or `path`. Prefer `path`. |
| pi          | `plan` or `path`. Prefer `path`. A leading `@` on `path` is stripped. |

`path` names a Markdown (`.md`) file holding the complete plan, either absolute or
relative to the session's directory.

Pass nothing else. The review's session and working directory come from the calling
session (OpenCode, pi) or from the MCP server (Claude Code). caret titles the review from
the plan's first `#` heading, else its first `##`, else its opening line, so open the plan
with `# <title>`.

## Send only plans

caret reflows whatever it receives into its own plan layout and presents it as a plan, so
a checklist, a schema, or a question sent through it arrives looking like something it
isn't. The tool's name and description are the only steer the model gets, and both tell
the model to send only plans.

## Wait for the decision

The call blocks until the reviewer decides:

- On [request changes](../reference/glossary.md#request-changes), the tool result
    carries the reviewer's [feedback](../reference/glossary.md#feedback), plus an
    instruction to revise and call again and not to implement anything until a call
    returns an approval. The plan itself is not echoed back: the agent still holds it, in
    its own tool-call arguments or in its file.
- On [approve](../reference/glossary.md#approve), the approval may carry the reviewer's
    notes in a clearly labeled section, to fold in as the work proceeds. Don't call again;
    the plan is approved.

So the loop is: call, read the feedback, revise, call again, until an approval returns.

A feedback line reference indexes the plan version caret stored, and an abbreviated quote
rides with it only when the agent may not hold that version line for line. That stored
[version](../reference/glossary.md#version) is reflowed to caret's 90-column shape by the
[plan formatter](../reference/glossary.md#plan-formatter) (see
[Plan formatting](../explanation/plan-formatting.md)), so the line numbers are caret's,
not yours, and the quote is what to match against your own text. A plan sent by `path` is
the exception: caret writes the reflowed text back onto the file, so the numbers match
once the agent re-reads it, and no quote is sent.

## Revise a plan file in place

With `path`, the loop runs on the file instead of regenerating the plan:

1. Write the plan once.
2. On a change request, re-read the file, make targeted edits, and call again with the
    same `path`.
3. On approval, there is nothing left to save. The file already holds the approved plan,
    with any reviewer notes appended unless you rewrote the file after caret read it. The
    notes still come back in the tool result too.

Because caret rewrites the file, it first checks OpenCode's edit permission on it. On
OpenCode v1, and on v2 from 2.0.29, it asks, and a denied ask comes back as an error with
no review. An older v2 gives a plugin no way to ask, so caret refuses every `path` review
there with an error naming 2.0.29, whatever the rules allow.

OpenCode's `plan` agent may edit plan files only in a few places, so caret's planning
steer, the instructions caret adds to the `plan` agent's prompt, tells it to write to
OpenCode's plans directory:

- on v1, `~/.local/share/opencode/plans` (under `$XDG_DATA_HOME` when that is set);
- on v2, `~/.opencode/plan`;
- or wherever `[opencode] plans_dir` in caret's
    [config file](../reference/config-file.md#the-opencode-table) points.

Any other agent can use any `.md` file its edit rules allow. On v2 a file outside the
project hits `external_directory`, which defaults to `ask`, so OpenCode asks the user.

## When the review fails

A failure never approves a plan. A spawn failure, an unparseable decision, or a timeout
(`review.timeout_s`, 1 hour by default; see [Config file](../reference/config-file.md))
all come back as a change request in Claude Code and OpenCode. In pi, a deny caret made
itself comes back as a failed review instead; caret marks such a deny `failsafe: true` in
its own wire format.

Cancelling a pending call on Claude Code (`esc`), or quitting Claude Code, expires its
review undecided: it leaves the [review page](../reference/glossary.md#review-page)'s
pending list rather than waiting out the timeout, and no agent is waiting on its result.

## Who may call it

### OpenCode

Any primary agent may call it; subagents may not. Only the planning steer points an agent
at the tool, and only the `plan` agent gets it; every other primary agent has to reach for
the tool deliberately. If your skill is pinned to a non-plan agent, `caret_review_plan` is
the route: OpenCode's own `plan_exit` is permitted on the `plan` agent alone, so there is
nothing to fall back on.

How caret keeps subagents off the tool, and what a deny-all permission config leaves of
it, is in
[How caret works § In OpenCode, only primary agents call it](../explanation/how-caret-works.md#in-opencode-only-primary-agents-call-it).

### Claude Code

Any agent may call it, subagents included. The tool grants no permission and gates no
edit, so there is nothing a subagent could bypass by calling it.

### pi

Any session may call it. Only the steers of `/caret <description>` and `/caret demo` tell
the model to use it. Otherwise the model sees just the tool's schema and its entry in pi's
tool list.

## What differs in Claude Code

Two things keep a long wait from failing:

- From Claude Code v2.1.212, a tool call still running after two minutes can move to the
    background. The tool's description tells the model not to act on the plan until the
    result arrives.
- The plugin gives the server a request timeout of `3900000` ms, the same 3900 s budget
    as the `ExitPlanMode` hook. That sits above the highest `review.timeout_s` caret
    accepts (it must stay below 3900 s), so caret's own timeout always answers first.

Two more behaviors follow from how the server is built:

- **One review at a time.** The server refuses a call made while a review is pending: it
    returns an error at once, telling the agent to wait for the pending decision. Every
    call from one Claude Code process shares a session id, so a second review would land
    as the next version of the pending one and end the first call with a deny. The same id
    makes a revised plan, sent after a change request, the next version of the same
    review; see
    [How caret works § In Claude Code, revisions join one review](../explanation/how-caret-works.md#in-claude-code-revisions-join-one-review).
- **Approve is always plain.** A tool result cannot change Claude Code's permission
    mode, so choosing accept-edits or auto when approving a tool-submitted plan approves
    it without switching modes.

## Next steps

- Set `review.timeout_s` and `[opencode] plans_dir` in the
    [config file](../reference/config-file.md).
- Look up a term in the [glossary](../reference/glossary.md).
