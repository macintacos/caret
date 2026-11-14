# Review your first plan

*Audience: people new to caret who use Claude Code on macOS or Linux.*

In this tutorial you install caret, have Claude Code present a
[demo plan](../reference/glossary.md#demo-plan), comment on it, ask for a change, and then
approve the new version. It takes about ten minutes. None of the steps changes any file in
your project.

## Before you start

You need:

- macOS or Linux.
- Claude Code, with the `claude` command on your PATH.
- [`bun`](https://bun.sh) on your PATH.
- A project folder to work in. Any folder with a few files in it will do.

To use caret with OpenCode or pi, or to set it up another way, see
[Install caret](../how-to/install.md).

## Install caret

In a terminal, run:

```sh
bunx --no-cache @macintacos/caret@latest install
```

The command first asks which agent hosts to add caret to. Claude Code is already selected,
so press `enter`. When it asks how to run the
[background service](../reference/glossary.md#background-service), answer
**Keep it running**. The background service starts now and at every login.

## Open the review page

Open <http://caret.localhost:42718> in your browser. This is the
[review page](../reference/glossary.md#review-page), where you review plans.

The first time, a **Welcome to caret** dialog offers desktop notifications, with
**Maybe later** and **Enable notifications**. Either button works for this tutorial.

With no plan waiting, it shows **No plans awaiting review**, the line "When an agent
proposes a plan, it opens here.", and a **listening** badge. Leave the tab open.

## Restart Claude Code

Claude Code loads caret only when it starts. Quit Claude Code if it is running, then start
it in your project folder:

```sh
cd path/to/your/project
claude
```

## Ask for the demo plan

In Claude Code, type:

```text
/caret demo
```

If Claude Code asks to enter plan mode, accept. Claude enters plan mode, where it proposes
a plan before it edits anything, and writes a short [plan](../reference/glossary.md#plan)
that cites files in your project. When Claude presents the plan, it appears in the review
page tab you left open, without a reload.

## Read the plan

The plan opens in the [preview](../reference/glossary.md#preview), rendered as a document.
Read it from top to bottom.

A file the plan cites has a small icon beside it. Click the icon. The file opens beside
the plan in a [file preview](../reference/glossary.md#file-preview), so you can check the
plan against your code.

## Leave a comment

Pick a line in the plan you would like changed. Click the line, or the **+** that shows
beside it when you hover. A box opens under the line.

Type a [comment](../reference/glossary.md#comment), such as "Make this step shorter." Then
click **Comment**. The comment stays under the line.

## Request changes

Click **Request changes** in the top bar of the review page. A dialog titled
**Send the plan back for revision** lists your comment. Click **Send for revision**.

caret sends your comment to Claude. Claude revises the plan and presents it again, and the
new [version](../reference/glossary.md#version) opens on the review page.

## Approve the plan

Read the new version. When you are happy with it, click **Approve** in the top bar. A
dialog asks **Approve this plan?**. Click **Approve** in it.

Back in Claude Code, Claude reports that you approved the plan in caret, and stops.
Because this was the demo plan, nothing in your project changes.

## What's next

- Type `/caret <what you want done>` in Claude Code to plan real work. When you approve,
    Claude starts the work.
- When Claude Code's plan mode presents a plan, that plan opens in caret too.
- The arrow beside **Approve** offers two more ways to
    [approve](../reference/glossary.md#approve). **Approve & accept edits** also lets
    Claude edit files without asking for the rest of the session. **Approve & auto mode**
    switches the session to auto mode.
- To set caret up for OpenCode or pi, update it, or remove it, see
    [Install caret](../how-to/install.md).
- To look up a word this site uses, see the [Glossary](../reference/glossary.md).
- For tasks beyond this tutorial, see the [How-to guides](../how-to/index.md).
