# Write feedback

*Audience: anyone commenting on a plan on caret's review page.*

This page covers picking the lines to comment on, citing skills and files in a
[comment](../reference/glossary.md#comment), and checking that each citation points at
something real.

## Comment on lines

Pick the lines a comment is about, then type it. In either view of the plan:

- Click a line to comment on it. In the [preview](../reference/glossary.md#preview),
  hovering anywhere out to the plan's right edge shades the wrapped line under the pointer
  and shows a **+** beside it. Clicking the line or its **+** comments on every source
  line with text on it.
- Drag across lines to comment on all of them.
- With the keyboard, press `V` to select whole lines, then `c` to comment on the lines the
  cursor or selection covers. In the preview, `V` shades its selection the same way, with
  the **+** on the cursor's line.

The lines stay shaded while you write. Clicking and dragging pick lines, not text, so hold
`shift` to select text instead. Selecting text opens no comment.

In the preview, comments and unsent drafts show right under the last wrapped line they
cover, and hovering or focusing one highlights the text it covers. Switching between the
preview and the [source view](../reference/glossary.md#source-view) with a comment open
keeps its text as a draft, which you resume in either view.

## Cite a skill or a file

Two characters open a list in any feedback editor: the comment box beside a line, a
comment card, and the **Request changes** dialog.

Type `/` at the start of a word to list the skills the agent that wrote this plan can use.
The list filters as you type. Choosing a skill inserts its name in the exact form that
agent needs, so a plugin skill arrives with its plugin's name in front, as
`/superpowers:brainstorming`. Each row shows where its skill came from, which tells apart
two sources that offer the same name.

Which skills the `/` list offers depends on the
[agent host](../reference/glossary.md#agent-host):

- Claude Code offers your own skills, the reviewed project's, and each enabled plugin's.
- OpenCode offers its slash commands.
- pi offers its skills.

caret reads the list once when the review opens, so a skill you add mid-review shows up
after you reload the page. The name becomes part of the
[feedback](../reference/glossary.md#feedback) the agent reads; caret never runs the skill
itself.

Type `@` to list the files under the project folder the agent was working in. The match is
loose, so `@srlbfoo` finds `src/lib/foo.ts`, and each row marks the characters your query
matched. Choosing a file leaves `@` and the path, relative to that folder, as ordinary
text, so the reference still resolves when the agent picks the plan up in a later session.
Type `:42` after the name to cite line 42 with it. In a project too large to search in
full, the list says how much of the result it shows.

To use either list:

- Move through it with the arrow keys, or with `tab` and `shift+tab`.
- Press `enter` to take the highlighted row. caret leaves a space after it, ready for the
  next word.
- Press `esc` to close the list without closing the dialog around it.

A `/` inside ordinary text, such as the path `src/lib/api.ts`, opens no list.

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
**Settings → Appearance** removes that line, and the shortcut keeps working.

## Check that a reference resolves

As you type, a reference caret can find shows as a chip, a small tinted label around the
text. One it cannot find stays plain text. A chip that never appears is how you catch a
misremembered skill name or a path that does not exist while you can still fix it.
Otherwise you find the mistake only when the agent sends back its revised plan.

caret checks each kind against the same source its list completes from:

- A `/name` against the skills the agent that wrote this plan has.
- A path against the project folder the agent was working in.

Both re-check as you edit, so fixing a typo brings the chip back.

A file or folder chip is green, and a skill chip is blue, so a comment carrying both shows
which is which at a glance. A path you completed with `@` keeps its `@` inside the chip,
because the agent reads it too.

In plain text, a path needs a `/` or a `.` before caret looks it up. That keeps an
ordinary word like `test` from becoming a chip because the project has a `test/` folder.
Wrap a name in backticks to mark it as a path, so `` `Makefile` `` at the top of the
project becomes a chip and a bare Makefile does not.

The chip only changes how the comment looks. The agent receives the exact text you typed,
chip or not.

## Next steps

- Read the plan you are commenting on with [Read a plan](read-a-plan.md).
- Send your comments and decide on a plan in
  [Review your first plan](../tutorial/first-plan.md#request-changes).
