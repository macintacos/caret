# Write feedback

*Audience: anyone commenting on a plan on caret's review page.*

## Comment on lines

Pick the lines a [comment](../reference/glossary.md#comment) is about, then type it. In
either view of the plan:

- Click a line to comment on it.
- Drag across lines to comment on all of them.
- With the keyboard, press `V` to select whole lines, then `c` to comment on the lines
    the cursor or selection covers.

After you submit a comment with `⌘↵`, the cursor rests on it.

With the cursor on a comment:

- `e` or `i` edits it.
- `Enter` expands a collapsed comment and edits an expanded one. On a **Resume** marker
    it resumes the draft.
- `h` collapses it and `l` expands it.
- `Shift+D` asks to discard it and discards on confirm.
- `c` comments on its lines, adding to its thread.
- `V` starts a selection on its last line.

Accepted and Expired comments only fold, with `h`, `l`, or `Enter` while collapsed. Key
caps show beside the controls of the comment the keyboard moved to, when the shortcut
hints setting is on. A mouse click hides them until the next key.

In the [preview](../reference/glossary.md#preview), hovering anywhere out to the plan's
right edge shades the wrapped line under the pointer and shows a **+** beside it. Clicking
the line or its **+** comments on every source line with text on it. `V` shades its
selection the same way, with the **+** on the cursor's line.

The lines stay shaded while you write. Clicking and dragging pick lines, not text, so hold
`shift` to select text instead. Selecting text opens no comment.

In the preview, comments and unsent drafts show right under the last wrapped line they
cover, and hovering or focusing one highlights the text it covers. If you switch between
the preview and the [source view](../reference/glossary.md#source-view) with a comment
open, caret keeps its text as a draft, which you resume in either view.

## Cite a skill or a file

In any feedback editor (the comment box beside a line, a comment card, or the
**Request changes** dialog), two characters open a list:

- `/` at the start of a word lists the skills the agent that wrote this plan can use.
- `@` lists the files under the project folder the agent was working in.

To use either list:

- Move through it with the arrow keys, or with `tab` and `shift+tab`.
- Press `enter` to take the highlighted row. caret leaves a space after it, ready for
    the next word.
- Press `esc` to close the list without closing the dialog around it.

A `/` inside ordinary text, such as the path `src/lib/api.ts`, opens no list.

The `/` list filters as you type. Choosing a skill inserts its name in the exact form that
agent needs, so a plugin skill arrives with its plugin's name in front, as
`/superpowers:brainstorming`. Each row shows where its skill came from, which tells apart
two sources that offer the same name. Which skills the list offers depends on the
[agent host](../reference/glossary.md#agent-host):

- Claude Code offers your own skills, the reviewed project's, and each enabled plugin's.
- OpenCode offers its slash commands.
- pi offers its skills.

caret reads the skill list once when the review opens, so a skill you add mid-review shows
up after you reload the page. The name becomes part of the
[feedback](../reference/glossary.md#feedback) the agent reads; caret never runs the skill
itself.

The `@` list matches loosely, so `@srlbfoo` finds `src/lib/foo.ts`, and each row marks the
characters your query matched. Choosing a file leaves `@` and the path, relative to the
project folder, as ordinary text, so the reference still resolves when the agent picks the
plan up in a later session. Type `:42` after the name to cite line 42 with it. In a
project too large to search in full, the list says how much of the result it shows.

## Preview what you cite

With a list open, press `ctrl+space` to open a panel beside it. The panel shows more about
the highlighted row: a skill's own description, or the opening lines of a file, colored in
the theme you are reading in. It follows the arrow keys, so you can tell `src/lib/api.ts`
from `src/lib/api.test.ts`, or `brainstorming` from `linear-plan`, without leaving the
editor. A `:42` after a filename moves the panel to that line and marks it. A line past
the end of the file says where the file ends.

The panel sits to the right of the list, or to its left near the window's right edge. In a
window too narrow for both side by side, the two stack on whichever side of your line has
room, and stay together on screen.

Opening the panel keeps your place in the list. Press `ctrl+space` again to close it.
caret remembers whether you left it open, so the next list you open, in this review or
after a reload, opens the same way. A skill with no description, or a file caret cannot
read, says so in a sentence, and the list keeps working.

The top of the list names the shortcut. Turning off **Shortcut hints** in
**Settings → Appearance** removes that line; the shortcut keeps working.

## Check that a reference resolves

As you type, a reference caret can find shows as a chip, a small tinted label around the
text. One it cannot find stays plain text. So a missing chip catches a misremembered skill
name or a path that does not exist while you can still fix it, rather than when the agent
sends back its revised plan.

caret checks each kind against the same source its list completes from: a `/name` against
the skills the agent that wrote this plan has, and a path against the project folder the
agent was working in. Both re-check as you edit, so fixing a typo brings the chip back.

A file or folder chip is green, and a skill chip is blue. A path you completed with `@`
keeps its `@` inside the chip, because the agent reads it too.

In plain text, caret looks a path up only when it has a `/` or a `.`, so an ordinary word
like `test` never becomes a chip, even when the project has a `test/` folder. Wrap a name
in backticks to mark it as a path: `` `Makefile` `` at the top of the project becomes a
chip, and a bare Makefile does not.

The chip only changes how the comment looks. The agent receives the exact text you typed,
chip or not.

## Send your feedback

Once your comments are in, decide on the plan from the top bar:

- **Request changes** (`r`) opens **Send the plan back for revision**. It lists your
    comments and adds a **General comment** box for the plan as a whole. Click
    **Send for revision**. The agent revises the plan and presents it again as a new
    [version](../reference/glossary.md#version).
- **Approve** (`a`) asks **Approve this plan?**, with an optional
    **Notes for the agent** box. Confirm it, and the agent starts the work. Your comments
    and notes go with the approval, and the agent applies them without another planning
    round. The arrow beside **Approve** lists your agent host's other ways to
    [approve](../reference/glossary.md#approve), when it has any.
- **Reject** (`shift+r`) asks **Reject this plan?**. Confirm it, and the agent is told
    the plan was rejected and to wait for your next message. Your comments are not sent.

When you have comments queued, the **Approve** and **Reject** dialogs list them and offer
**Request changes** instead. Choose it when a comment changes the plan's structure, so you
review the revised plan before the work starts.

Drafts you kept for later show in these dialogs under **Unsent comments**, and caret does
not send them. To send one, click **Cancel**, click **Resume** on the draft in the plan,
then click **Comment**.

In a window under 960px wide, **Reject** and **Request changes** move into the `…` menu
beside **Approve**. Under 640px, **Approve** joins them.

## Next steps

- Read the plan you are commenting on with [Read a plan](read-a-plan.md).
- Try the whole loop on a demo plan in
    [Review your first plan](../tutorial/first-plan.md).
