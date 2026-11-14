# Glossary

*Audience: people using caret with Claude Code, OpenCode, or pi.*

These are the words this site uses, with one name for each thing.

## `/caret` command

What you type in an agent host: `/caret <what you want done>`, `/caret demo`, or
`/caret doctor`. A bare `/caret` lists them. Claude Code lists the command as
`caret:caret`. Older pages call it the caret skill.

## Agent

The AI model working in an agent host. It writes the plan and acts on your decision.
OpenCode also calls its modes agents, such as `plan` and `build`.

## Agent host

The coding tool caret plugs into: Claude Code, OpenCode, or pi. Older pages call it the
harness or the host.

## Approve

Accepts the plan. Any comments you left go to the agent with it. In Claude Code,
**Approve & accept edits** also switches the session to accept edits, and
**Approve & auto mode** switches it to auto mode. In OpenCode v2, **Approve & build**
switches to OpenCode's `build` agent, its mode for editing files.

## Background service

The caret program that serves the review page and passes your decision back to the agent.
By default `caret install` sets it to start at login, and `caret serve` runs it by hand.
Without it running, caret still starts when your agent sends a plan. Older pages call it
the daemon, the server, the background process, or the caret service, and caret's install
messages still say caret service.

## Comment

A note you attach to one or more lines of a plan. Older pages call it an annotation.

## Demo plan

The short sample plan that `/caret demo` shows. Approving it changes nothing.

## Feedback

Everything caret sends the agent with your decision: your comments, plus the
**General comment** you can add when you request changes, or the **Notes for the agent**
you can add when you approve.

## File preview

A file the plan cites, opened beside the plan. Older pages sometimes call it a preview,
but on this site Preview means the rendered plan.

## Outline

The list of a plan's headings, shown beside it so you can jump between sections.

## Plan

What the agent proposes to do before it changes your files.

## Plan formatter

The tool, rumdl, that caret uses to rewrap a plan's lines before showing it.
`caret install` installs it.

## Plan switcher

The list of every plan waiting across your sessions. Older pages call it the switcher.

## Preview

The plan rendered as a document. A plan opens in this view. Older pages call it the
rendered preview.

## Reject

Stops the plan without sending feedback. The agent waits for you.

## Request changes

Sends your feedback to the agent, which revises the plan and presents a new version.

## Review

One plan waiting for your decision, and what you do with it: read it, comment on it, and
decide.

## Review page

caret's page in your browser, at <http://caret.localhost:42718> by default, where you
review plans. Older pages call it the review UI, the web UI, or the caret UI, and caret's
install prompt still calls it the review UI.

## Review tool

The tool an agent calls to send a plan to caret: `review_plan` in Claude Code, and
`caret_review_plan` in OpenCode and pi. To call it from your own skill, see
[Call the review tool from your own skill](../how-to/review-tool.md).

## Source view

The plan's Markdown as stored, with line numbers. Older pages call it the source.

## Version

One revision of a plan. Each Request changes produces a new one. Older pages call it a
revision.
