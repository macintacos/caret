# Read a plan

*Audience: anyone reading a plan on caret's review page.*

This page covers the two ways caret shows a plan, the text size, the outline and its peek,
and opening the files a plan cites.

## Switch between the preview and the source view

caret shows each [version](../reference/glossary.md#version) of a plan on the
[review page](../reference/glossary.md#review-page) in one of two views:

- The [preview](../reference/glossary.md#preview) renders the plan as a document, with
    headings, lists, tables, and links as they would appear on a page. Code blocks are
    highlighted and keep the source view's copy and wrap buttons.
- The [source view](../reference/glossary.md#source-view) shows the plan's Markdown as
    stored, with a line number on every row.

A plan opens in the preview. To switch, press `s` or click the **Source** button beside
**Versions**. The button shows as pressed while the source view is on screen. Your browser
remembers the choice, so it holds across reviews and restarts.

Switching keeps your place: the other view opens at the part of the plan you were reading.
A link to a heading opens at that heading in either view, and the address bar follows the
heading you are reading in both.

These also work in the preview:

- Cited files open, and the outline and breadcrumbs work.
- The keyboard cursor moves one wrapped line at a time.
- `/` search runs over the text as rendered, so a phrase wrapped across source lines
    matches, while link addresses and Markdown markers do not.

When you compare two versions to see what changed, caret always shows the source view and
hides the **Source** button. Leaving compare mode returns to the view you chose.

## Change the text size

Set **Base font size** in **Settings → Appearance** to size the preview's body text. It is
15px by default, and the preview's headings and code scale with it.

In a window wide enough for the preview's column, each wrapped line keeps its words at any
zoom. In a narrower window, or beside a
[file preview](../reference/glossary.md#file-preview), the preview rewraps to the space it
has and keeps your place while it does.

## Find your way with the outline

The [outline](../reference/glossary.md#outline) down the left of the plan lists its
headings and marks the one you are reading. Click a heading to go to it.

- Press `\` to filter the outline.
- Press `shift+\` to hide or show it. Your browser remembers a hidden outline.
- Drag the outline's right edge to make it wider or narrower, or tab to the edge and use
    the left and right arrow keys. Double-click the edge to return it to its default
    width. Your browser remembers the width.

With a file open beside the plan, neither a drag nor a double-click widens the outline
past the width that keeps it beside the plan.

The outline folds into a button at the left of the plan's header, which opens it over the
plan, when:

- the window is under 960px wide;
- a file opened beside the plan would leave the plan too narrow to read at the outline's
    current width;
- you compare versions, so the comparison has the width.

While you compare, the opened outline lists only the sections that changed, each with its
line count, and clicking one takes you to the change. Leaving compare mode brings the
outline back to how it was before.

## Peek at a section

Rest the pointer on a heading in the outline, or move to one with the arrow keys in the
outline's filter, and a peek of its section opens beside the outline. The peek shows the
section as the plan's current view draws it, cut short with a fade where the section runs
on. A heading with only subheadings under it shows its subheadings' sections.

Once open, the peek follows the pointer or the arrow keys from heading to heading. Press
`s` to flip it to the other view along with the plan. If that view has not drawn the
section yet, the peek closes.

The peek closes when:

- the pointer leaves the outline, or the outline loses focus;
- you turn the mouse wheel, or click;
- you press a key other than the arrow keys, `tab`, `home`, `end`, or `s`;
- you change the filter or pick a heading.

There is no peek while you compare versions.

## Open a file the plan cites

A file the agent cited shows a small icon beside it in either view. Click it to open a
file preview of that file beside the plan. The file preview shows the head of the file, or
the lines the reference names, so `src/mail/send.ts:127-141` opens on line 127. A folder
opens its tree instead.

caret recognizes two ways a plan cites a file:

- a path in backticks, such as `` `src/mail/send.ts` ``;
- a path in parentheses beside the thing it belongs to, the way a plan cites its
    evidence: ``the retry lives in `attempt_send` (src/mail/send.ts:127-141)``.

A path loose in a sentence gets no icon, so ordinary words never look like files. In
parentheses, a path needs a `/` or a `.`, so `(Makefile)` gets no icon, while
`` `Makefile` `` in backticks does.

caret checks each path against the project folder the agent was working in. A path that
does not exist there stays plain text, with no icon and nothing to click, so a filename
the agent invented never looks like one you can open.

## Next steps

- Comment on what you read with [Write feedback](write-feedback.md).
- Walk through a whole review in [Review your first plan](../tutorial/first-plan.md).
