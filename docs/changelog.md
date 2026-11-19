# Changelog

Every caret release, newest first, as its
[GitHub Release](https://github.com/macintacos/caret/releases) describes it.

## v1.11.1

Released 2026-11-19 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.11.1)

caret 1.11.1 fixes two bugs: a plan review that was rejected at once when the agent
outlived the directory it started in, and a menubar app that `caret install --refresh`
could fail to reload.

### Fixed

- A plan review no longer comes back as "changes requested" before anyone looks at it
    when the agent's session started in a directory that has since been deleted, such as a
    removed worktree. caret now starts the review from `/`, so the review opens in the
    browser as usual. This covers Claude Code, OpenCode and pi alike.
- `caret install --refresh` reloads a running menubar app instead of failing with
    `launchctl bootstrap failed (5): Input/output error`. caret now waits for launchd to
    finish removing the old app before it starts the new one, and the background service
    install does the same.

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.11.0...v1.11.1

## v1.11.0

Released 2026-11-19 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.11.0)

caret 1.11.0 adds a menubar app for macOS: a carrot that colours in while a plan waits for
review and opens on a card of your review stats. It also lets the Vim keys stop on
comments and act on them, renders markdown in the review title and breadcrumbs, and
publishes the docs as a site at
[macintacos.github.io/caret](https://macintacos.github.io/caret/).

![The caret carrot in the macOS menu bar fades from grey to orange as a plan arrives, its menu opens on a card of review stats, and the carrot fades back to grey once the plan is reviewed](https://github.com/macintacos/caret/releases/download/v1.11.0/menubar.gif)

### Added

- A menubar app for macOS 13 or later. `caret install` asks whether to show caret in the
    menu bar, and the answer defaults to yes. A LaunchAgent starts the app at login and
    relaunches it after a crash, and **Quit** keeps it closed until the next login.
    `caret install --uninstall` removes it, and so does caret's own cleanup once caret is
    gone from every agent host. See
    [Show caret in the menu bar](https://macintacos.github.io/caret/how-to/menubar/).
- The carrot colours in while a plan waits for review and greys out once none does. It
    fades between the two and grows a little as a plan arrives; with Reduce motion on, it
    switches at once.
- The carrot's menu opens on a card of your review stats: the running caret's version,
    plans approved and rejected, revisions, and comments. The card takes the accent of
    your review page's theme, and **Open caret** sits below it.
- Comments are stops for the Vim keys. `j`/`k` stop on each comment card and unsent
    draft in the source view and the preview, and `]c`/`[c` jump between comments. The
    comment under the cursor takes keys of its own: `e` edits, `h`/`l` fold, `Shift+D`
    discards after a confirm, `c` adds to its thread, and `V` selects from its last line.
- A documentation site at
    [macintacos.github.io/caret](https://macintacos.github.io/caret/), with a tutorial,
    how-to guides, reference and explanation pages, a glossary, and a changelog of every
    release.

### Changed

- The top bar and the plan's breadcrumbs render inline markdown in titles and headings
    (bold, italics, code and strikethrough) instead of showing the raw syntax.
- In the preview, a file the plan cites reads as inline code whether or not the agent
    put it in backticks.
- The theme JSON Schema moved to
    `https://raw.githubusercontent.com/macintacos/caret/HEAD/docs/theme.schema.json`, and
    its old `doc/` URL now returns 404. Update the `$schema` line in your theme files:
    caret still loads a file that keeps the old line, but your editor stops completing and
    validating it.

### Fixed

- A caret built from source can tell how far behind `main` it is again. Its update check
    and What's new compared against `trunk`, which stopped resolving when the default
    branch was renamed to `main`; they now compare against `HEAD`.
- The file preview's left edge and its shade run unbroken past the line numbers, which
    used to paint over them.
- A daemon lock naming pid 0 no longer reads as a running daemon, so caret can't signal
    its own process group while retiring one.

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.10.1...v1.11.0

## v1.10.1

Released 2026-11-12 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.10.1)

caret 1.10.1 adds a hover to OpenCode's pending-plan line and stops a source-view image
that fails to load from shifting the lines around it.

### Changed

- On OpenCode, pointing at the pending-plan line above the prompt turns its
    `open in browser` hint bold in the theme's action colour, the way OpenCode's own
    toasts mark their action.

### Fixed

- A plan image in the source view takes up room only once it has loaded, so one that
    fails to load no longer shifts the lines around it, including the line an open comment
    is on.

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.10.0...v1.10.1

## v1.10.0

Released 2026-11-12 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.10.0)

caret 1.10.0 replaces the three slash commands with a single `/caret` on Claude Code,
OpenCode and pi: `/caret <description>` plans, `/caret doctor` runs the report, and
`/caret demo` runs the demo. The old `/caret:plan`, `/caret:doctor` and `/caret:demo` are
gone with no aliases, and a bare `/caret` no longer opens the waiting review.

### Changed

- One argument-routed `/caret` replaces the three per-host commands:

    | Before | Now |
    | --- | --- |
    | `/caret:plan <description>` | `/caret <description>` (or `/caret plan <description>`) |
    | `/caret:doctor` | `/caret doctor` |
    | `/caret:demo` | `/caret demo` |
    | `/caret` to open the waiting review | `<leader>p` (OpenCode v2) or `ctrl+alt+o` (pi) |
    | blank `/caret:plan` in pi to leave planning | `/caret plan` |

- A bare `/caret` prints a usage hint.
- In Claude Code the command is listed as `caret:caret` with the argument hint
    `[what you want done] | doctor | demo`; a typed `/caret` resolves to it.
- In pi, typing `/caret` offers `plan`, `doctor` and `demo` as completions.
- On OpenCode, `/caret doctor` and a bare `/caret` leave the session on the `plan`
    agent, because one command file carries one `agent:` key. The command says so and how
    to switch back.
- `caret install` on OpenCode removes the `caret:*.md` command files older versions left
    behind, leaving your own command files alone.

### Removed

- A blank `/caret:plan` no longer plans what you asked earlier in the session.

### Fixed

- A plan breadcrumb level that came back while it was animating out could stay
    invisible, leaving a hole where it belonged.

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.9.0...v1.10.0

## v1.9.0

Released 2026-11-11 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.9.0)

caret 1.9.0 adds pi as a third host beside Claude Code and OpenCode: `caret install` sets
it up, `/caret:plan` puts pi's agent in a planning mode that routes its plan to caret for
review, and a notice above the editor flags a waiting review. It also opens every plan in
the rendered preview, with the source one `s` away.

### Added

- **pi support.** `caret install` now offers pi (1.5.0 or later) alongside Claude Code
    and OpenCode. It installs, updates, and removes caret through pi's own package
    commands, leaves a pinned entry alone, and keeps pi to one caret entry.
- **`caret_review_plan` in pi.** pi's agent submits an inline or `.md` plan and waits
    for your decision; approvals, approval notes, and change requests reach the model as
    the tool result. Esc cancels a waiting review, and a review caret could not run tells
    the model to stop and tell you instead of reading as a change request.
- **`/caret:plan [task]` in pi.** pi has no plan mode of its own, so this adds one: the
    agent writes its plan under pi's `plans/` folder and submits it to caret, and `edit`
    and `write` calls outside that folder are blocked until you approve the plan. Planning
    survives `/reload` and resume.
- **A pending-plan notice in pi.** While a review waits, pi shows a one-row notice above
    the editor and a `caret` footer status. Click the notice, run `/caret`, or press
    `ctrl+alt+o` to reopen the review in the browser. The shortcut needs Option to act as
    Alt/Meta in Terminal.app and iTerm2.
- **`/caret:demo` and `/caret:doctor` in pi.** The demo walks a new user through a
    review end to end; doctor puts its verdict and report in pi's transcript without
    sending them to the model.
- **pi checks in `caret doctor`.** When pi's settings list caret, doctor adds `pi-host`
    (a missing or too-old pi), `pi-caret-entry` (caret listed twice, filtered out, or
    missing its package), and `pi-caret-version` (an npm caret behind the published one).
- **pi skills in `/` completion.** A review opened from pi offers your pi skills as
    `/skill:<name>` in the comment editor.

### Changed

- **Plans open in the rendered preview.** The view toggle beside **Versions** is now a
    **Source** button on `s`; `p` no longer toggles the plan view. A browser that used
    caret before is moved to preview once, with a one-time popover on the Source button
    pointing the way back. Your choice still persists per browser.
- `caret doctor` starts its adapter checks before its daemon health probe, so a slow
    host version check no longer times the probe out.

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.8.1...v1.9.0

## v1.8.1

Released 2026-11-09 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.8.1)

caret 1.8.1 adds vim's `zz`, `zt` and `zb` to scroll the plan around the cursor, `]]` and
`[[` to jump between changes in compare, and lets a hook attach to a caret daemon on
another machine, so you can review a server's plans from another device. It also keeps a
tall row such as an inline image on screen when `j`/`k` lands on it.

### Added

- **Scroll around the cursor with `zz`, `zt` and `zb`.** On both the source view and the
    preview, they scroll the cursor line to the center, or to the top or bottom edge of
    the band the `j`/`k` follow keeps, without moving the cursor or a visual selection.
    With no cursor placed, each first reveals one at the reading position. A row too tall
    for that margin, such as an inline image, is centered instead, and near the end of the
    plan the scroll glides to rest at the end of its range. The `?` help lists them.
- **Jump between changes in compare.** In the compare-versions view, `]]` and `[[` step
    forward and back through the changes, scrolling each to just below the pinned file
    header. A stop is a run of changed lines, not a whole hunk, so separate edits in one
    hunk each get their own. The jump stops at either end instead of wrapping, and holding
    the key advances one change per press. Off compare, the keys still jump between
    headings.
- **Review on another machine's daemon.** A hook whose `daemon.host` is not an address
    on its own machine now attaches to the caret daemon there, instead of refusing because
    the state-directory paths differ. It never retires, restarts or spawns that daemon,
    whatever version each side runs, and denies the review with
    `no caret daemon is answering at …` when nothing answers. `doc/RUNNING.md` covers the
    setup, the cleartext token, and the limits of a daemon acting on the server's files.

### Fixed

- **`j`/`k` onto a tall row keeps it on screen.** Moving the cursor onto a row taller
    than the follow's margin, such as an inline image, centers it instead of scrolling it
    off screen.

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.8.0...v1.8.1

## v1.8.0

Released 2026-11-05 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.8.0)

caret 1.8.0 adds Approve & build for OpenCode v2, which approves a plan and switches the
session from `plan` to `build` in the same turn, and lets you open a waiting plan from
inside OpenCode: `/caret`, `ctrl+x p`, a card above the prompt, or the review toasts. It
also rewraps the plan preview to fit a narrowed pane instead of scrolling it sideways, and
raises the OpenCode v2 floor to 2.0.29.

### Added

- **Approve & build on OpenCode v2.** A review sent from v2's `plan` agent offers a
    second approve option, Approve & build, which approves the plan and switches the
    session to the `build` agent, so implementation starts in the same turn. Plain Approve
    stays the default and leaves the session in `plan`; once you pick Approve & build, the
    browser remembers it for later v2 reviews. If the switch fails, the plan stays
    approved and the agent is told the session is still in `plan`. OpenCode v1 reviews,
    and v2 reviews from any other agent, show a single Approve.
- **Open the waiting plan from OpenCode v2.** `/caret`, a command-palette entry, or
    `ctrl+x p` (rebindable as `caret.open`) opens the plan waiting in the current session
    in your browser, and the palette suggests it while a plan waits. Off a session it
    opens caret's home page. If caret can't start, a "caret: open failed" toast points at
    `caret doctor`.
- **A pending-plan card above the prompt.** On OpenCode v2, the session a plan waits in
    shows a card above its prompt, `^caret  plan waiting for your review`, with the open
    key and "open in browser" on the right. A click opens the review, and approving,
    denying or cancelling clears it. It takes its colours from the OpenCode theme, and
    other sessions show nothing. A terminal started or reattached after the plan arrived
    doesn't show it.
- **Toasts open the waiting session.** On OpenCode v2, the "review this plan" toast and
    the decision toast after it offer to open the session the plan waits in when you're
    looking at a different one.

### Changed

- **The plan preview rewraps to fit.** Beside a file docked on the right or in a narrow
    window, the preview's text rewraps to the pane instead of scrolling the plan sideways,
    and the line at the top stays put through a resize. Wide tables and code blocks still
    scroll in their own box, and comments stay on their lines.
- **The outline column stays beside a docked file** instead of folding away. `Shift+\`
    and the header's outline button show or hide the column, and `\` focuses its filter,
    or opens the outline popup while the column is hidden or the window is under 960px.
- **OpenCode v2 needs 2.0.29 or later.** On v2 2.0.18–2.0.28, caret still loads but
    refuses every `path` review with a message naming 2.0.29, and `caret doctor`'s
    `opencode-host` check fails with an upgrade remedy. Inline `plan` reviews still work.
    The v1 floor stays at 1.3.4.
- **Plan formatting** uses rumdl 0.3.2, which caret downloads on first use after the
    upgrade. It keeps the indentation inside a multiline code span after a bare list
    marker, and may add a blank line between a heading and a list or code block directly
    under it.

### Removed

- **Compare's outline.** Compare has no outline, so its changed-sections popup is gone
    and `\` and `Shift+\` do nothing there.

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.7.1...v1.8.0

## v1.7.1

Released 2026-11-04 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.7.1)

caret 1.7.1 rebuilds the waiting room around a lit `^` key that turns the carrot fact,
with a stamp that reads "listening" or "offline". It also smooths the hand-off into and
out of a plan, which no longer stutters, and a page opened on a pending plan no longer
flashes the waiting room first.

### Changed

- **The waiting room's `^` is a lit key.** It is a rubber key set in a bed, its legend
    lit in the accent with a slow breathing glow. A click or the `^` shortcut turns the
    carrot fact, plays the tap sound and restarts the timer. Offline, the key sits down
    and its legend goes dark; if the key held focus, focus moves to the heading.
- **A listening stamp.** The waiting room's hint is a stamp with the status bar's LED
    that reads "listening" or "offline", and announces the change.
- **Waiting room copy.** Connected, it reads "When an agent proposes a plan, it opens
    here." Offline, it says the page reconnects on its own once the daemon is running.

### Fixed

- **The plan hand-off.** Going to a plan and back crossfades without a stall, and the
    two views no longer dip through the background.
- **Opening on a pending plan** shows the plan straight away, with no flash of the
    waiting room first.

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.7.0...v1.7.1

## v1.7.0

Released 2026-11-03 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.7.0)

caret 1.7.0 moves the outline out of its popover into a resizable column beside the plan,
where resting on a row previews its section, under a new plan header that holds the
breadcrumbs, Search, Versions and Preview. It also gives the review UI a tactile finish:
buttons sink when pressed or triggered by their shortcut, the plan sits in a recessed
pane, and Settings and search are rebuilt to match.

### Added

- **An outline column beside the plan.** The outline stands as a column left of the
    plan, resizable from its right edge between 12rem and 30rem. The arrow keys step a
    focused edge, a double-click resets it, and the width is remembered. Under 960px wide,
    or beside an open file, it drops from the Outline key as a float instead. While
    comparing, the column folds away and the key opens a float of the changed sections.
- **Section previews from the outline.** Resting on an outline row, under the pointer or
    the arrow keys, shows that section beside the outline, taken from the source view or
    Preview. It never covers an open file.
- **A plan header.** A header above the plan holds the breadcrumbs, a Search entry,
    Versions and Preview. The Search entry replaces the "/ to search" hint and is a
    button, so it stays usable with shortcut hints off.

### Changed

- **A tactile finish.** Buttons are domed caps set in inset wells that sink when
    pressed, and a keyboard shortcut plays the same press on its button. Modals, menus and
    popovers float on layered shadows and share one 14px corner, and the plan's chips and
    code blocks are stamped or recessed into the page. The plan sits in a pane set into
    the window, whose edges shade while there is more to scroll. Keyboard focus looks like
    hover, with no focus ring.
- **Settings** sets each section's rows in recessed groups, with a latching switch, a
    level-meter volume slider, and Advanced values as code blocks with copy and wrap.
- **Search.** The find row slides out of the Search entry, and a committed query is
    stamped. The current match is an opaque mark, the strongest thing on the page in every
    theme, and every other match is a wash a step below it.
- **Unsent comments.** Comments kept for later read as Unsent everywhere — under the
    line, in the outline's count, in Request changes and in the approve guard — in a
    tinted well with their own glyph. A saved comment can be marked unsent from Request
    changes.
- **Filter fields** clear from an × inside the field, in the outline and the breadcrumb
    bar. The Clear button at the outline's foot is gone.
- **Labels and stamps** such as Folder, Preview, In use and table headers are in
    sentence case. Shortcut keycaps stay in capitals.
- **The working directory** sits centred on the status bar. A click still copies the
    full path.

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.6.0...v1.7.0

## v1.6.0

Released 2026-10-29 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.6.0)

caret 1.6.0 adds OpenCode v2 support, so `caret install` now wires caret into OpenCode v2
as well as v1. It also opens What's new on its own after an upgrade, and shows the
screenshots in release notes there.

### Added

- **OpenCode v2 support.** caret now loads on OpenCode v2 (2.0.18 and later) as well as
    v1 (1.3.4 and later). `caret install` writes it under v2's `plugins` entry, the `plan`
    agent offers `caret_review_plan`, and a plan opens in caret's review UI as it does on
    v1. In an attached v2 TUI, the review-link toast appears while a review is pending.
- **What's new after an upgrade.** The first time the review UI loads after caret
    upgrades, What's new opens on its own, titled "Updated to caret X", with the notes for
    every release since the last version that browser saw, newest first. Closing it keeps
    it shut on reload. With `[updates] check = false` it makes no GitHub call and stays
    closed. Announcements start with the upgrade after this one, since an existing install
    has no record of the version it last saw.
- **Images in What's new.** Release-note screenshots hosted on GitHub now show in What's
    new, scaled to the dialog's width. Images from anywhere else are still stripped.

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.5.0...v1.6.0

## v1.5.0

Released 2026-10-27 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.5.0)

caret 1.5.0 lets you approve a plan with its inline comments, so the agent applies them as
it implements instead of losing them or needing another planning round.

### Added

- **Approve with comments.** With comments queued, the approve confirmation now reads
    "Approve with comments" and lists what it sends; the line-cited comments reach the
    agent in the plan's `## Notes from the user` section, alongside any Notes text.
    Unsaved composer drafts are listed separately as unsent, and on Codex, whose approval
    can't carry a message, the dialog warns instead of promising delivery. Previously
    "Approve anyway" sent only the Notes text and dropped the comments.

![The approve dialog listing two line-cited comments under "Sent with your approval", with an "Approve with comments" button](https://github.com/macintacos/caret/releases/download/v1.5.0/approve-with-comments.png)

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.4.2...v1.5.0

## v1.4.2

Released 2026-10-24 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.4.2)

caret 1.4.2 adds a band above Claude Code's prompt while caret holds a plan for review,
with a link that opens that review. It also smooths the review surface: plan swaps
crossfade instead of jumping, every state transition runs at one 160ms pace, and
`caret doctor` lists failing checks first.

### Added

- While caret holds a plan for review, Claude Code shows a 🥕 band above its prompt, so
    the session no longer looks idle. Its link, or `1` in an empty prompt, opens that
    session's review in the browser, already logged in when token auth is on. Approving,
    denying, cancelling or timing out clears it. Turn it off under Settings →
    Notifications or with `review.band = false`; the change applies from the next review.
    The band needs Claude Code 2.1.287 or later; older versions keep caret's hooks and
    show no band.
- `caret doctor` and `caret install` take `--no-color`, and both print plain text under
    `TERM=dumb` as they already did under `NO_COLOR` and `CI=true`.

### Changed

- Every plan swap crossfades: a plan arriving, the next plan after a decision, switching
    plans, opening one from a notification, and the queue emptying. A plan renders
    highlighted on its first paint instead of recolouring a moment later, and Approve and
    Request Changes stay busy until the next plan is on screen.
- Menus, dialogs, popovers and alerts open and close at one 160ms ease-out instead of
    three different durations.
- Key hints are hidden on touch devices, whatever the shortcut-hints setting says.
- `caret doctor` opens with a header line, then the failing checks in one block with
    each fix beside it, and ends on the next command to run.
- caret's sound cues use cuelume's new palette, so every cue sounds different.

### Fixed

- In the caret-light theme, faint text and the bright accent meet 4.5:1 contrast on
    every surface, which also makes the primary button's hover label readable.
- A plan table whose delimiter row is missing a cell renders as a table instead of raw
    pipes.

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.4.1...v1.4.2

## v1.4.1

Released 2026-10-19 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.4.1)

caret 1.4.1 sizes the plan preview's inline code and code blocks to match the prose around
them.

### Fixed

- Inline code and code blocks in the plan preview render at 0.9em, so monospace text no
    longer reads larger than the sans text beside it.

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.4.0...v1.4.1

## v1.4.0

Released 2026-10-17 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.4.0)

caret 1.4.0 adds a markdown preview: press **Preview** or `p` to read the plan as a
rendered document, and comment, search and move the cursor in it the same way as in the
source view. It also changes how comments reach the agent: they cite line numbers without
quoting the plan when the agent has the same copy of it.

### Added

- A markdown preview of the plan. The **Preview** button beside **Versions**, or `p`,
    switches between the line-numbered source view and the rendered plan, and the browser
    remembers the choice. Switching keeps your place in either direction. Compare mode
    always shows source and brings the preview back when it closes.
- The preview reads like a GitHub README, in the active theme's colors. Code blocks are
    highlighted for their language and have the source view's copy button and wrap toggle.
    A table's header stays at the top of the view while its rows scroll under it. Raw HTML
    in a plan is sanitized, and tags that would load a resource or navigate somewhere
    render as text.
- Commenting in the preview. A click or drag selects whole rows and opens the composer
    under the last row, on every source line those rows came from, so the agent receives
    the same comment it would get from the source view. Saved threads and drafts show
    under their rows, and hovering a comment highlights its text.
- The keyboard works in the preview. `j`/`k`, `gg`/`G`, `Ctrl+d`/`Ctrl+u`, `{`/`}` and
    `]]`/`[[` move a cursor through wrapped lines; `V` selects lines and `c` comments on
    them. `/` search matches the text as you read it, so a phrase that wraps across two
    source lines counts as one match, while link URLs and markdown syntax never match.
- File references, the contents popup, breadcrumbs, `b`, `\` and `?heading=` links all
    work in the preview.
- Settings → Appearance → Preview → Base font size sets the preview's text size from 12
    to 20px (15px by default). The preview's column keeps the same words on each row at
    any zoom level, and scrolls sideways when the window is too narrow for it.

### Changed

- When the agent has the same copy of the plan as caret, line for line, review feedback
    cites only line numbers. The plan text is quoted only when the agent's copy may be
    numbered differently.
- In the source view, the pointer cursor shows over plan text. Holding Shift switches to
    the text cursor for selecting text, and a Shift-click opens no composer.

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.3.2...v1.4.0

## v1.3.2

Released 2026-10-14 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.3.2)

caret 1.3.2 lets theme files style each markdown heading level on its own, and the
built-in themes now give H1 through H4 their own colors so a plan's outline reads at a
glance.

### Added

- Theme files take optional `heading1` to `heading6` keys in the `markdown` object. A
    level without its own style falls back to `heading`, and a level's style replaces
    `heading` whole. `heading` still styles headings outside markdown, such as
    reStructuredText, AsciiDoc, Org and MDX. The plan view, the excerpt preview and the
    comment editor all apply the levels, and a theme that sets only `heading` renders as
    before.

### Changed

- The built-in themes color their heading levels apart: H1 to H4 each take their own hue
    from the theme's palette. Catppuccin Latte and Dawnfox step by ink tone and font style
    instead, since no other color in either palette stays readable on the code surface.

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.3.1...v1.3.2

## v1.3.1

Released 2026-10-14 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.3.1)

caret 1.3.1 lets theme files style a plan's markdown: headings, inline code, link text,
bold, italic, list markers and blockquotes each take their own color and font style. The
built-in themes now use it, so each element reads in its own hue instead of the accent.

### Added

- Theme files take an optional `markdown` object that styles headings, inline code, link
    text, bold, italic, list markers and blockquotes. Each element uses the
    `{ color, fontStyle }` shape of the syntax roles. The plan view, the excerpt preview
    and the comment editor all apply it, and a theme without it renders as before.
    [Theme files](https://github.com/macintacos/caret/blob/trunk/doc/CONFIGURING.md#theme-files)
    documents the keys.

### Changed

- The built-in themes set markdown colors from their own palettes, so headings, inline
    code and links no longer share the accent. Catppuccin Latte and Dawnfox keep most
    markdown text in their neutral text colors and put their hue on list markers and
    chips, where it stays readable.

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.3.0...v1.3.1

## v1.3.0

Released 2026-10-13 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.3.0)

caret 1.3.0 adds custom themes: put a JSON theme file in caret's `themes` folder or upload
one from Settings → Appearance, and it shows up in the theme picker next to the built-in
themes. It also adds `caret convert-theme` to turn a VS Code theme into a theme file,
Dawnfox and Duskfox palettes, and a copy button on the upgrade command.

### Added

- Custom themes. Theme files in the `themes` folder of caret's config dir
    (`~/.config/caret/themes`) appear in Appearance's picker for their scheme after a
    reload. Files that fail to load are listed there with their errors. A picked custom
    theme paints from the first frame. If its file is edited, deleted or unreadable, the
    slot falls back to caret's theme and keeps the saved pick until the file is back.
    [Theme files](https://github.com/macintacos/caret/blob/trunk/doc/CONFIGURING.md#theme-files)
    documents the format.
- A JSON theme file format, with a published schema (`doc/theme.schema.json`) so an
    editor can check a file through `$schema`. Errors read one `path: message` line per
    problem. A file sets caret's chrome palette and 11 required syntax roles. Nine
    optional roles (operators, brackets, parameters, `this`, tags, built-in functions and
    types, and template `${ }`) each fall back to a required role. caret's built-in themes
    ship as theme files, so each one is a working example to copy.
- Settings → Appearance has an "Upload theme file…" button. It validates the file, saves
    it to the themes folder as `<id>.json`, and adds it to the picker without a reload.
    Uploading a theme whose id is already in use replaces that theme, and the open plan
    repaints with it. An invalid file lists its errors and nothing is saved.
- `caret convert-theme <file> [--out <file>]` turns a VS Code color theme (JSON or
    JSONC) into a caret theme file. Code colors come from the theme's token rules. Chrome
    colors are a best-effort pick from its `colors`, and each one it can't find falls back
    to caret's theme with a note. Output goes to stdout unless `--out` names a file.
- Dawnfox (light) and Duskfox (dark) palettes from Nightfox, with Nightfox's own code
    colors.
- The upgrade command in What's new and Settings → Updates has a copy button.

### Changed

- Code colors in the Catppuccin, Dracula and GitHub themes now come from each theme's
    converted syntax roles instead of the upstream theme, so a few tokens are colored
    slightly differently. The chrome is unchanged, and the UI bundle is about 1.4 MB
    smaller.
- [Reaching caret from another device](https://github.com/macintacos/caret/blob/trunk/doc/RUNNING.md#on-the-other-devices)
    now covers the other devices. A browser-only device needs no caret. A device running
    its own agent should answer "I'll run it myself" at install and keep the server's
    `host` and `hostnames` out of its `config.toml`.

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.2.0...v1.3.0

## v1.2.0

Released 2026-10-07 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.2.0)

caret 1.2.0 lets you review plans from another device: set `host` and `hostnames` in
`config.toml`'s `[daemon]` table, then open the link `caret login-link` prints once on
each phone, tablet or computer. It also keeps comments and key order when `caret install`
edits a hand-written OpenCode config, and gives `plan` sessions started outside OpenCode's
TUI the same steer and daemon warm as the TUI's.

### Added

- The review UI can be reached from other devices. Three new `[daemon]` keys in
    `config.toml` set the address the daemon binds (`host`), the names it answers to
    (`hostnames`, on any port and over HTTPS), and whether it asks for a token (`auth`).
    [Reaching caret from another device](https://github.com/macintacos/caret/blob/trunk/doc/RUNNING.md#reaching-caret-from-another-device)
    walks through the setup, including running behind an HTTPS reverse proxy.
- Token auth for the daemon. It turns on when `host` is exposed or `auth = "token"`.
    Opening the login link once sets a cookie that keeps the device logged in, marked
    `Secure` behind an HTTPS proxy. `caret serve` prints the link on every start, and the
    new `caret login-link` prints it for the service's daemon. Review links use the first
    `hostnames` entry. With no `host` set, caret behaves as before and never asks for a
    token.
- `caret doctor` has an `opencode-host` check. It lists every `opencode` on your `PATH`
    and fails when OpenCode is older than 1.3.4, the oldest version caret supports, or
    when caret sits in a config file or key your OpenCode doesn't load, naming
    `caret install` as the fix.

### Fixed

- Changing `daemon.port` or `daemon.host` no longer leaves a second daemon running
    beside the first. The next review restarts the service, or retires an on-demand daemon
    left on the old address, before it starts one, and a review left open follows the
    daemon to its new address.
- On OpenCode, a `plan` session started without naming an agent — `opencode run` without
    `--agent`, the SDK, or a web client — now gets caret's planning steer and daemon warm,
    as sessions started from the TUI do.
- Interrupting OpenCode during a caret review stops the review and shows a "caret:
    review cancelled" toast instead of reporting that changes were requested.
- `caret install` and `--uninstall` keep the comments, indentation and line endings of a
    hand-written OpenCode config, leave caret's entry in its slot in the plugin array, and
    refuse a config that lists the plugin key twice instead of writing a broken edit.
- `caret install` writes caret into the one global OpenCode config file your OpenCode
    loads and removes it from the others, so OpenCode never sees two caret entries.
    `--dry-run` lists every file it would change, and a config that fails to parse stops
    install before it writes anything.
- `caret install` recognises a `file:` OpenCode entry naming a packed caret tarball
    (`macintacos-caret-<version>.tgz`) as caret's own, so it replaces it instead of adding
    a second caret entry. Uninstall and `caret doctor` see it too.

### Security

- An invalid `config.toml` now leaves the daemon on loopback with token auth on, instead
    of falling back to no auth. `caret login-link` prints the link to log in.

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.1.1...v1.2.0

## v1.1.1

Released 2026-09-27 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.1.1)

caret 1.1.1 adds a `caret doctor` check that flags a daemon older than npm's latest, and
keeps the background service on the caret you installed: `caret install` keeps its own
copy, waits for the service to answer, and names the version it started. It also fixes
stale-cache detection for OpenCode, `caret doctor` under a `--from-local` OpenCode
install, and a published install run after a local Claude Code build.

### Added

- `caret doctor` checks the running daemon's version against npm's latest and, when it
    is behind, names `caret install --refresh` as the fix. A dev build is not compared.
- `caret install` names the version and path of the caret the service starts, once the
    service answers.

### Changed

- Releases publish to npm from CI with trusted publishing, and a GitHub Release goes
    live only once npm serves its version, so the update toast never announces a version
    you can't install yet.

### Fixed

- Clearing OpenCode's cache with `caret install --refresh` no longer drops the service
    to an older caret or stops it: install keeps a copy of the caret it ran under
    `~/.local/state/caret/roots/`, and `--uninstall` removes it.
- `caret install` waits up to 30 seconds for the service to answer before announcing it,
    and warns — naming the version it saw and `daemon-stderr.log` — when nothing answers,
    another caret holds the port, or an older caret answers.
- With no runnable caret installed, `caret install` warns and skips the service restart
    instead of cycling the service into an exit.
- The service skips a half-installed caret with no UI build instead of starting it.
- `caret doctor` fails the daemon check when the service's job is not loaded or is
    turned off.
- `caret doctor` and `caret install --refresh` read the caret version OpenCode actually
    installed, so a stale OpenCode cache is detected and cleared. A version range in
    OpenCode's cache used to read as unknown, and the refresh never ran.
- `caret doctor` recognises a `caret install --from-local` OpenCode entry instead of
    reporting caret as not enabled.
- A published `caret install` after a `--from-local` build hands Claude Code's `caret`
    marketplace back to the published one. Claude refused the add while the local build
    was declared, and install reported success anyway; it now also warns, naming the
    remedy, when `caret` is registered from another source.
- A malformed review id in a daemon URL returns 404 instead of a 500 and an error-level
    log record.

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.1.0...v1.1.1

## v1.1.0

Released 2026-09-25 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.1.0)

caret 1.1.0 adds a What's new dialog that shows what an update changes before you install
it, a `/caret:plan` command that sends a fresh plan straight to review, and
`caret doctor`, which checks your install and names the fix for each failure. It also
keeps a plan you rejected in Claude Code's terminal on the same review as v2, lets you
soft-wrap a long code block in place, and crossfades back to the waiting room after your
last decision.

### Added

- A **What's new** dialog, opened from the update toast or Settings → Updates, shows the
    release notes for every release you skipped, or the commits a local build is missing,
    with a compare link and the upgrade command.
- `/caret:plan <task>` for Claude Code and OpenCode asks the agent for a plan and routes
    it through caret's review before any work starts.
- `caret doctor` and `/caret:doctor` check the daemon, its lock, your agent's caret
    install, recent log errors, and whether OpenCode loads a stale caret, and name the
    remedy for each failure. `--bundle` zips the raw logs and review records after asking
    first.
- Error log records carry a stable error code and the review id, and `caret doctor`
    groups the last 24 hours of failures by review.
- Fenced code blocks have a soft-wrap toggle, so a prose paragraph written as one long
    line reads without scrolling sideways.

### Changed

- Deciding the last pending plan crossfades the whole window to the waiting room instead
    of snapping to it.
- Code block copy and wrap controls are always visible instead of appearing on hover.
- Releases are titled by their bare version.
- Contributor tooling moves to hk 2.

### Removed

- `caret discovery`, `/caret:discovery` and `/caret:debug`, replaced by `caret doctor`.

### Fixed

- A plan resubmitted after you reject it in Claude Code's terminal dialog lands as v2 of
    the same review, with a diff against v1, instead of opening a new review.
- caret reviews the plan file's current contents instead of the stale plan Claude Code
    can send when the agent writes the plan and exits plan mode in the same turn, and no
    longer overwrites the new file with the old plan.
- Approval notes are no longer appended to a plan file the agent rewrote after caret
    read it.
- A hook polling a review the daemon already expired gets an immediate deny instead of
    waiting up to an hour, and no longer keeps the daemon from shutting down when idle.
- Two hooks starting the daemon at once no longer spawn two daemons.
- Long code blocks that scroll sideways now have a copy button.
- `.lua` files are syntax-highlighted in the file preview.
- Dividers are no longer announced as separators by screen readers, and focused controls
    show an outline in forced-colors mode.

**Full Changelog**: https://github.com/macintacos/caret/compare/v1.0.2...v1.1.0

## v1.0.2

Released 2026-09-18 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.0.2)

caret 1.0.2 updates the build toolchain to Bun 1.4.2 so compiled macOS binaries pass
strict signature verification. It also refines the README.

### Changed

- Updated release builds to Bun 1.4.2.
- Refined the README wording and presentation.

### Fixed

- Fixed invalid embedded signatures in compiled macOS binaries.

## v1.0.1

Released 2026-09-16 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.0.1)

caret 1.0.1 retires `prefs.json`: the update check becomes an `[updates] check` key in
`config.toml`, edited alongside every other setting, and the approve mode you last picked
is remembered by your browser instead of the daemon. It also fixes a config path that
could stop the daemon from binding — an unreadable `config.toml` was treated as empty and
overwritten wholesale — and slims the README down to what a new reader needs.

### Added

- `[updates] check` in `config.toml` controls the update check. Writes rewrite that one
    line in place, keeping your comments and formatting; a rewrite that would touch
    anything else refuses and the UI toggle asks you to edit by hand.

### Changed

- The remembered approve mode now lives in the browser, per origin, rather than
    machine-wide in the daemon — it is a click you repeat, not a machine setting.
- `POST /api/prefs` is now `POST /api/config`, and the daemon reads the value off the
    hot-reloading settings service.
- `--fresh` points the daemon at a config inside its own ephemeral state directory
    rather than a guessable path in the shared tmpdir, and resets the remembered approve
    mode in the live session.
- The README is trimmed; `doc/CONFIGURING.md` documents the `[updates]` table.

### Removed

- `prefs.json`, migrated once at boot. `GET /api/prefs` is gone with it.

### Fixed

- An unreadable or unwritable `config.toml` is refused rather than overwritten or thrown
    through the boot migration, so a bad config path no longer stops the daemon from
    binding. The refusal reason reaches the 409 and the migration warning.

## v1.0.0

Released 2026-09-15 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v1.0.0)

caret 1.0.0 adds a login service: `caret install` registers a launchd agent on macOS or a
systemd user unit on Linux, so the review UI is up from login and hooks attach to it
instead of spawning their own daemon, and `caret serve` runs it in the foreground for
anyone who would rather not. It also lets Claude Code request a review through a
`review_plan` MCP tool without entering plan mode, lets OpenCode's `caret_review_plan`
take a plan file path, and derives clean plan titles for every adapter.

### Added

- `caret install` registers caret as a login service — a launchd user agent on macOS, a
    systemd user unit on Linux — so the review UI stays running between plans (EXC-1160,
    EXC-1161, EXC-1162, EXC-1163, EXC-1164, EXC-1167).
- At a terminal, `caret install` asks whether to keep the review UI running as a service
    or run it yourself; choosing the latter removes the service (EXC-1251).
- `caret serve` keeps the daemon up in the foreground until Ctrl+C (EXC-1251).
- The Claude Code plugin bundles a `caret mcp` server whose `review_plan` tool sends a
    plan to the review UI and blocks until you approve or request changes (EXC-1338).
- OpenCode's `caret_review_plan` accepts a `path` to a markdown plan file; caret writes
    the reformatted plan back and appends approval notes, and `[opencode] plans_dir` sets
    where the Plan agent writes it (EXC-1340).
- `/caret:demo` presents a richer shared plan with a table, nested headings, a code
    block, and file, folder and `path:line` references drawn from the working directory
    (EXC-1226).
- Diagnostics report whether the daemon is running as a service (EXC-1239).

### Changed

- A daemon stepping down drains in-flight decisions first, so a restart no longer cuts
    off an approval mid-write (EXC-1165).
- Hooks attach to the service's daemon, restarting the service to pick up an upgrade
    rather than spawning a second copy, and a review sent during a restart waits for the
    new daemon (EXC-1166, EXC-1258).
- `caret install --from-local` and `mise run dev` work alongside a running service
    (EXC-1168, EXC-1234).
- Re-running `caret install` leaves an unchanged, healthy service alone, so macOS no
    longer posts "Background Items Added" every time (EXC-1233).
- A long-running daemon drops reviews untouched for a week from memory and skips their
    files at boot (EXC-1239).
- caret derives every plan title itself from the plan's first heading or opening line,
    ignoring code blocks and refreshing on each revision, and each agent is asked to open
    its plan with a `# <title>` line (EXC-1350).
- `caret install` names the off switches that actually stick, since turning caret off
    under System Settings › Login Items does not survive a reinstall (EXC-1262).
- The daemon answers unchanged UI assets with a `304` (EXC-1218).
- caret moves to Bun 1.4, and the unit suite runs in parallel (EXC-1156, EXC-1215).
- The README no longer flags caret as an early prototype.

### Removed

- `caret install` no longer takes `--target`; at a terminal it asks which agents to
    install into, and otherwise installs into every agent it detects (EXC-1252).

### Fixed

- A plan-review call with no plan text is denied up front with instructions to resend
    the full plan, instead of opening an empty "Untitled plan" (EXC-1337).
- Holding a shortcut key runs it once instead of toggling on every key repeat; cursor
    motions such as `j`/`k` still repeat (EXC-1131).
- Bold, italic and code spans that wrap across lines render styled (EXC-1342).
- A comment on a line inside a horizontally scrolling code block renders under that line
    rather than below the whole block (EXC-1228).
- Under the service, the daemon's log directory is created before it starts and stays
    private (EXC-1232).
- The install announcement for the service is broken into short lines.

## v0.14.0

Released 2026-08-31 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.14.0)

caret 0.14.0 adds update awareness: the daemon now notices when the running build has
fallen behind the published one, and the review UI says so, with a dismissal it remembers
across restarts. It also hardens the daemon's loopback HTTP trust boundary, teaches the
plan view to catch file references written in bare parentheses, and focuses the notes
field the moment the approve modal opens.

### Added

- The daemon detects when the running caret build is behind the latest published version
    (EXC-1205).
- The review UI surfaces that pending update instead of leaving it in the logs
    (EXC-1207).
- The UI can write daemon-side preferences, so dismissing the update notice sticks
    (EXC-1206).
- `mise run test` takes `--json`, emitting one verdict document on stdout, and stays
    quiet at a terminal (EXC-1146).

### Changed

- The update verdict is re-checked as the daemon runs rather than frozen at boot, so a
    release published mid-session still shows up (EXC-1210).
- File-reference resolution is batched into a single fan-out instead of one round trip
    per reference.
- `doc/RUNNING.md` covers the plan view's file references.

### Fixed

- File references written in bare parentheses are recognised (EXC-1184).
- A link label's cited line range survives when the target names none, so
    `(foo.ts:10-20)` keeps its range (EXC-1192).
- Split tokens in the diff view renumber their character offsets, fixing selection
    anchored past a split.
- The approve modal focuses its notes field on open, so you can type straight into it
    (EXC-1212).
- E2E specs no longer race their own animations or click a dismissible layer before it
    arms (EXC-1193, EXC-1200, EXC-1204).

### Security

- The daemon's loopback HTTP trust boundary is hardened against requests that reach it
    from outside the local UI (EXC-1203).

## v0.13.0

Released 2026-08-27 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.13.0)

caret 0.13.0 adds completion to every feedback editor: `@` offers the files under the
review's working directory, `/` offers the skills the review's own agent can load, and
Ctrl+Space opens a preview of the highlighted row — a file's cited lines, syntax-coloured,
or a skill's description. It also chips the references a comment already holds, so a run
caret can resolve wears a pill and one it cannot stays prose.

### Added

- `@` in a feedback editor completes file paths under the review's working directory,
    fuzzy-matched by the daemon and inserted as a cwd-relative path. A `:42` citation
    after the query splits off, rides into what gets inserted, and opens the preview on
    that line.
- `/` completes the skill names the review's agent would load — Claude's user, project
    and plugin roots, or OpenCode's command directories — each row labelled with its
    origin.
- Ctrl+Space previews the highlighted completion in a panel beside the list: a file's
    lines through the plan view's own shiki themes, or a skill's description. The toggle
    persists, and the panel places itself against the list every frame — beside it,
    flipped, or stacked.
- References a feedback editor recognizes are chipped as you type, using the same
    resolution the plan view and the `/` source already use.
- Two daemon routes behind the new sources: `POST /api/reviews/:id/file-search` and
    `GET /api/reviews/:id/skills` / `:id/skill-description`, each 404ing when no
    capability is wired.
- `listSkills` and `readSkillDescription` join the adapter interface as its sixth and
    seventh surfaces.

### Changed

- The completion list and preview panel wear caret's own chrome — raised paper, hairline
    rule, chip lift, the accent's wash on the selected row — instead of CodeMirror's stock
    grey panel, which under a dark scheme painted white on white.
- Matched characters are emphasised in `@` rows with `--mark`, so a subsequence match
    says why the row is in the list.
- Escape is keyed on a painted list rather than on completion status, so a dismissed
    list no longer closes the composer under it.

### Fixed

- A plugin installed against another project no longer shadows the install the review
    can actually reach, which offered skills the reviewing agent would never load.
- One daemon hiccup on the first `/` keystroke no longer disables skill completion for
    the rest of the tab's life; a transient failure now evicts its cache entry while a
    settled 404 stays cached.
- A reference ending a sentence, a `` `constructor` `` codespan, and a chipped
    codespan's doubled pill are all handled; a CRLF skill file no longer reports having no
    description.
- A lone annotation card is keyed on its comment's id, so a review switch that lands a
    different comment on the same line no longer reuses the previous card's open editor.
- Backspacing off a typo re-arms the completion source instead of leaving the list shut
    for the rest of the token.
- The e2e suite waits out the renderer's keyboard handover before its first keystroke,
    which was reddening a different unrelated typing spec on every run.

## v0.12.0

Released 2026-08-24 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.12.0)

caret 0.12.0 adds a searchable table-of-contents popup for jumping around a plan, a folder
card that opens files and reopens where you left it, and sound for UI events with a volume
slider to tame it. It also retunes the motion vocabulary for a native feel, renders plan
tables as real tables in a floating card, and rebuilds the settings controls on vendored
shadcn primitives.

### Added

- A table-of-contents popup, opened with `\` or the new top-bar button: search the
    headings with the matched characters highlighted, walk the results with Tab, and read
    a result's ancestors from a single breadcrumb header. The tree stays nested while you
    filter, with indent guides and a glyph per heading level.
- A folder card you can open files from, that reopens where you left it, coexists with
    the file preview, and refreshes its cached tree.
- Sound for caret UI events, with a volume slider in sound settings.
- A badge on first use teaching file and folder previews, and subdued carrot facts on
    the waiting screen.
- Plans that arrive while you are reading another one are marked, so a queued plan is
    not silently waiting.
- Hold a navigation key to keep walking the headings, and walk the breadcrumb list with
    Tab / Shift-Tab.
- A comma now works as a line-range separator.

### Changed

- Plan tables render as real tables with the pipes hidden, presented — like code blocks
    — as a floating inset card.
- The motion vocabulary is retuned for a native feel: modal enter, exit, and backdrop
    are choreographed together, a decided modal hands off to the next state, breadcrumb
    levels animate out as well as in, every animated chrome surface was audited against
    the feel, and the chip drop shadows are toned down.
- Settings rows are rebuilt on vendored shadcn components — select, field and label,
    input-group for the three search fields, a spinner for loading placeholders, and a
    popover-based confirmation.
- The plan's scroll-to-a-place jump is snappier, ArrowLeft matches `h`, a second Escape
    blurs the search bar, and the compare-versions button is now just "Versions".
- The plan's task checkboxes were reworked.
- The umbrella build hides its output behind a progress line.

### Fixed

- The breadcrumb walk no longer stops on a level that is leaving, and a submenu closes
    the one that is open rather than the one that is focused.
- The folder card no longer swallows keys in compare mode.
- The daemon pins its working directory, so deleting a project directory can no longer
    strand it.
- JS dependencies are reinstalled when the lockfile moves ahead of `node_modules`.
- CodeMirror modules are deduped in the UI bundle.
- The ToC breadcrumb header stays on one italic line.

## v0.11.1

Released 2026-08-15 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.11.1)

caret 0.11.1 adds size-triggered log rotation — logs now live under a `logs/` directory,
archive to gzip once they cross a size limit, and keep a configurable number of archives —
and sweeps the toolchain forward to TypeScript 7, Biome 2.5, listr2 11, Playwright, and
every runtime dependency at current. It also trims the dependency tree, moving
build-time-only packages to `devDependencies` and dropping what nothing uses, and makes
the README hero screenshot and video regenerable from one `mise run assets` command.

### Added

- Size-triggered log rotation. An oversized log is archived to
    `logs/archive/<name>-<stamp>.log.gz` and truncated in place, so the daemon and
    concurrent hook writers keep writing through the same file descriptor with no reopen.
    Concurrent rotations are serialized by a lock with a 60-second stale takeover.
- `[logging].max_size` and `[logging].keep` config keys, with `CARET_LOG_MAX_SIZE` and
    `CARET_LOG_KEEP` environment overrides, to tune the rotation threshold and how many
    archives to retain.
- `mise run assets` regenerates both README hero artifacts — the four-theme stitched
    screenshot and the review-arc video — by booting an isolated daemon and driving the
    built UI, replacing the hand-composed screenshot that could not be rebuilt.

### Changed

- Live logs moved into a `logs/` directory created at `0700`; an existing top-level
    `caret.log` or `daemon.log` is migrated across automatically.
- Adopted TypeScript 7, and bumped Biome to 2.5, listr2 to 11, rumdl to 0.2.54, the
    OpenCode plugin to 1.18, and the mise-managed `pkl` and `hk` pins.
- Swept runtime dependencies, the frontend build toolchain, the diffview stack,
    happy-dom, and Playwright to current versions.
- Reclassified build-time-only packages from `dependencies` to `devDependencies`, so an
    install of the published plugin pulls less.
- Refreshed the vendored Lucide icons against upstream.
- The exact-pin gate now understands `overrides` and `resolutions`, so pins declared
    there no longer read as unpinned.
- Recorded the dependency placement rules, caret's three rumdl roles, and the `-y` and
    `--no-deps` flags for `shadcn-svelte add` in the contributor docs.

### Removed

- Dependencies that a reachability audit found nothing uses.

### Fixed

- The README asset assertion no longer fails against the regenerated hero images.

## v0.11.0

Released 2026-08-13 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.11.0)

caret 0.11.0 renders plan markdown for real: tables, images, lists, task-list checkboxes,
blockquotes, and horizontal rules all draw as themselves, and bold, italics, links, inline
code, and file references render as tinted chips you can still comment on line by line. It
also fixes three reference bugs — a spacey code span and emphasis inside a path no longer
masquerade as file references, and the file preview no longer swallows the first click
outside it.

### Added

- Markdown tables render as real tables, with inline commenting parity — a comment
    anchors to a table row the same way it anchors to any other line.
- Markdown images render inline in the plan view.
- Blockquotes render with level bars and subdued ink, so nesting depth reads at a
    glance.
- List bullets and ordered-list numbering render properly, and task-list items render as
    checkboxes.
- Horizontal rules render as rules.
- Bold and italics render, on a shared decoration pass over the plan's inline markdown.
- Inline code renders as a chip, and fenced code rows are styled as chips too.
- Links collapse to a link chip rather than sprawling raw URLs across the line.
- Resolved file and folder references get their own chip tint, distinct from other
    chips.
- The plan view's chip tints are part of the theme recipe, so they follow the active
    theme.
- The dev fixture carries a markdown rendering showcase, exercising every supported
    construct in one plan.

### Changed

- The plan view's markdown decorations were reworked into a single pass, giving
    citations and nested chips a uniform look.
- A regression sweep and visual polish pass over the review surface.

### Fixed

- A code span containing spaces is no longer treated as a file reference.
- Markdown emphasis inside a path no longer splits a file reference in two.
- The file preview no longer eats the first click outside it.

## v0.10.0

Released 2026-08-11 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.10.0)

caret 0.10.0 turns markdown links in a plan into live file and folder references — a file
opens an inline preview with syntax highlighting, virtualized rows and its cited line
range lit up, and a folder expands as an interactive tree. It also brings revision
comments into the compare view anchored to the diff line they belong to, and reorganizes
the docs: `ADVANCED.md` splits into four focused pages with `doc/README.md` as the router
into them.

### Added

- Markdown links to files in a plan render as file references, previewing the file
    inline.
- Markdown links to folders render as folder references, previewing the directory as an
    interactive tree that loads each level on demand.
- Revision comments appear in the compare view, each one linked to the diff line it was
    written against.
- `doc/README.md` is now the doc router — it points at the right reference page instead
    of holding content of its own.
- `doc/DEVELOPMENT.md` documents the isolated ad-hoc dev instance used for agent
    verification.

### Changed

- File previews stream in as appended chunks that auto-load on scroll, replacing the old
    strip loading; rendered rows are virtualized, and each chunk is highlighted with
    grammar state carried from the chunk before it, so highlighting stays correct across
    boundaries.
- The preview's code region is keyboard-reachable, the whole cited line range is
    highlighted rather than a single line, and the cited line stays anchored even as
    virtualized rows recycle around it.
- Preview contents settle in and out instead of snapping, and the 2 MB preview ceiling
    has been raised now that content loads incrementally.
- Plan references resolve by kind rather than by file extension, so extensionless files
    and directories resolve correctly.
- The review chrome carries real accessible semantics — proper roles and names for the
    surrounding controls.
- Syntax highlighting no longer races a wall clock: shiki tokenizing is bounded by work
    done, not elapsed time, which removes a source of inconsistent output under load.
- `mise run preflight` scopes its task set to the diff, so a docs-only change no longer
    pays for the full gate.
- `ADVANCED.md` is split into four focused pages (CONFIGURING, RUNNING, ARCHITECTURE,
    DEVELOPMENT), the configuring and running docs are restructured to be scannable, and
    the README, architecture reference and development guide each got an editorial pass.

### Fixed

- A link's click region is confined to the link's own text instead of spilling into the
    surrounding line.
- cmux's unread mark clears once a plan has been reviewed.
- The README no longer points at a bug-report destination the repo doesn't provide, and
    `RUNNING.md` plus the discovery command descriptions match the actual reporting flow.
- `CONTRIBUTING.md`'s fresh-checkout setup instruction is correct.
- The `fake-plan.md` line citations in `doc/DEVELOPMENT.md` are guarded by a test, so
    they can't silently drift.
- The e2e suite no longer flakes under preflight load; its conventions are codified and
    gated, its locators are role- and text-based, and its fixed per-test cost is cut.

### Removed

- Three redundant e2e specs, with the layer choices behind the cut recorded.

## v0.9.0

Released 2026-08-03 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.9.0)

caret 0.9.0 replaces the table-of-contents rail with a heading breadcrumbs bar you can
walk by keyboard, filter, and jump from to any heading in a plan, and docks the file
preview as a resizable drawer that now reaches the whole file. It also adds a
dependency-free bootstrap so a fresh clone sets itself up, opens the review tool to any
primary agent, and binds shift+r to Reject.

### Added

- A heading breadcrumbs bar across the top of the plan, showing the trail to the heading
    you are reading with a sibling menu at every level.
- Keyboard control of the breadcrumbs bar — invoke it, walk the trail, and filter the
    full heading list by typing, so every heading in a plan is reachable without the
    mouse.
- The file preview now docks as a resizable drawer instead of an overlay, so you can
    size it against the plan and keep both in view.
- `shift+r` as the Reject shortcut, alongside the existing approve binding.
- A dependency-free bootstrap for fresh clones: every `mise` task routes through it, and
    it skips the setup steps it has already run.

### Changed

- The review tool is allowed on any primary agent, not just the ones caret ships with.
- The file preview expands to reach the whole file, rather than only the referenced
    span.
- Chrome colors follow the palette's hue assignments, so themes stay coherent across the
    UI.
- Plan links read as links at rest, not only on hover.
- The top bars sit on a tighter horizontal inset.
- Documented how to call the review tool from a skill.

### Removed

- The table-of-contents rail, superseded by the breadcrumbs bar; its sidebar key is
    rebound.

### Fixed

- Line-anchored feedback now resolves to the line it was attached to.
- A comment composer clipped by the viewport scrolls itself into view.
- Link URLs are exempt from plan reflow, so long URLs are no longer broken mid-string.
- TypeScript comment scopes highlight correctly under JavaScriptCore.
- `b` toggles the whole breadcrumbs bar rather than part of it.
- Picking a heading moves focus and the cursor along with the scroll position.

## v0.8.2

Released 2026-07-28 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.8.2)

caret 0.8.2 fixes an install-breaking bug that has shipped since 0.5.0 — every bundled
install served the daemon's "UI not built yet" placeholder instead of the review UI — and
gives `caret install` a real upgrade path, where `--refresh` brings a stale OpenCode or
Claude Code install current. It also redraws caret-dark and caret-light as a named
earth-pigment color set, with syntax themes authored to match rather than derived from the
UI palette.

### Added

- `caret install --refresh` checks whether the caret each agent would load is behind the
    published one, and updates it: clearing a stale OpenCode plugin cache or bumping a
    stale version pin, and running `plugin update` for Claude Code. Without the flag the
    check prompts; off a terminal it names the gap and the command and changes nothing.
- caret-dark and caret-light get shiki themes of their own, authored rather than
    derived. Eleven syntax-only hues separate types from functions, numbers from escapes,
    and attributes from properties — distinctions the derivation had no colors to draw.

### Changed

- caret-dark and caret-light are redesigned as a named 27-color set in an earth-pigment
    direction. Dark mode's page is a kraft brown rather than a neutral near-black, its
    rules ride bone instead of pure white, and the accent is a designed carrot-top. Both
    schemes pull further from their ink than before, and every hue clears its contrast
    floor on the surfaces it sits on.
- Install and uninstall sweep caret's pre-array-install OpenCode artifacts — the
    file-deploy-era plugin file in both `plugins/` and `plugin/`, plus the
    `caret:`-namespaced command files in `command/`. OpenCode scans both spellings, so a
    leftover plugin file registered a second `caret_review_plan` beside the array entry.
- `caret install --from-local` writes a `file:` entry pointing at the checkout for
    OpenCode, so a local build is the copy OpenCode actually loads. It previously wrote
    the npm specifier, and a bare specifier resolves once and never re-resolves — so
    OpenCode kept loading whatever its cache held, potentially many releases old.
- The README and `doc/ADVANCED.md` update instructions point at
    `caret install --refresh`. The old ones said to delete a cache path caret has never
    written, which made the documented update a silent no-op.

### Fixed

- Bundled installs served the daemon's "UI not built yet" placeholder instead of the
    review UI. The bundle collapses to a single output file, so the one candidate path for
    `ui/dist` overshot the package root by a level and no on-disk tree resolved. Every npm
    and GitHub install since 0.5.0 was affected.
- A `caret review` that loses its connection attaches to the running daemon instead of
    taking the port over. A client whose review outlived an upgrade is running the old
    build, so every dropped poll reinstated that build's daemon — and reconnects outpace
    rebuilds, so it won indefinitely.
- The OpenCode discovery probe reported every healthy install as not-installed. It read
    `opencode/node_modules/<pkg>`, a path OpenCode never writes; it now resolves the real
    `packages/<specifier>/` layout and reads the version from that directory's manifest.

## v0.8.1

Released 2026-07-27 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.8.1)

caret 0.8.1 highlights the vendor palettes with their own upstream shiki theme, so picking
Dracula now renders Dracula's pink keywords rather than caret's approximation of them. It
also fixes inline file references — the icon, pointer cursor, and hover chip that every
vendor palette had been swallowing.

### Changed

- Dracula, GitHub, and Catppuccin syntax-highlight from their upstream shiki theme
    instead of caret's seven-role derivation, which maps colors those themes use at no
    scope. caret's own light and dark pair still derives.

### Fixed

- Inline file references keep their icon, pointer cursor, and hover chip under all seven
    vendor palettes. Upstream themes color the opening backtick exactly like the code
    inside it, so shiki merged the two into one token and the reference lost everything
    but its click target.

## v0.8.0

Released 2026-07-26 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.8.0)

caret 0.8.0 adds nine themes — Catppuccin, GitHub, Dracula and caret's own two — with
independent light and dark slots that follow the OS by default, and syntax highlighting
that paints in whichever theme is live. It also sharpens the review surface: modals play
an exit before they close, the compare toggle counts how many other versions a plan can be
diffed against, and the ink ramp holds its contrast floors on raised surfaces like dialogs
and dropdowns.

### Added

- Seven vendor palettes — Catppuccin Latte, Frappé, Macchiato and Mocha, GitHub Light
    and Dark, and Dracula — join caret's own light and dark for nine in the picker. The
    hex is upstream verbatim; only the mapping onto caret's tokens is ours.
- Light and dark are now independent slots under a light/dark/system mode. System is the
    default, so caret follows the OS and swaps slots live when it flips; a pinned mode
    overrides it. The Appearance pane shows both slots at once and marks the live one.
- Syntax highlighting derives per palette, so picking Dracula paints Dracula code inside
    Dracula chrome instead of leaving amber highlighting behind. The filename-excerpt
    popover highlights in the live theme too.
- The "Compare versions" toggle badges how many other versions the current plan can be
    diffed against, and the base/target pickers mark the newest row `(current)`.
- Modals hold in the DOM long enough to play an exit animation before they unmount, and
    a re-open mid-exit mounts a fresh surface.
- A derived-token tier for the colors a palette implies rather than decides, declared so
    it re-derives correctly inside any subtree painted with a different palette.

### Changed

- A palette can be painted onto any element, not just the document root — theme preview
    cards now carry the full stamp, so scheme-keyed rules inside a preview resolve against
    the palette being previewed rather than the page's.
- One module owns the live appearance, repainting only when the resolved theme actually
    moves.
- caret's own two palettes build through the shared theme recipe, and the first-paint
    `:root` fallback is generated from the theme registry rather than hand-maintained
    beside it.

### Fixed

- Dialog enter and exit animations were keyed on a state bits-ui never sets, so
    Settings, Shortcuts, Request Changes and the approve guard had no animation at all.
- The ink ramp held its contrast floors only against the base surface. On raised
    surfaces — dialogs, dropdowns, cards — Frappé's secondary copy sat below AA and three
    palettes' metadata below 3:1.
- The version count reached screen readers through a `<span>`, which ARIA prohibits from
    carrying a name; it now rides the toggle's own label.

### Removed

- `CHANGELOG.md` is retired. Release notes are composed for the GitHub Release, which is
    now the single record of what shipped.

## v0.7.3

Released 2026-07-25 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.7.3)

caret 0.7.3 makes `caret install` the one way in: it detects your coding agents and asks
which to install into, and the old install.sh shell installer is gone — its dev loop now
runs through the same command. It also warms the OpenCode daemon when you message the Plan
agent, so the first review skips the cold start, and fixes a theme preview that could land
in the wrong place on a fast reopen.

### Added

- **`caret install` picks its own targets.** Run it with no flags and it detects which
    coding agents you have, then asks which to install into with the detected ones
    pre-checked. `--target` still works byte-for-byte for CI, and off a terminal it never
    waits on the prompt — it installs into every agent it found, or Claude Code if it
    found none. Every install also downloads the rumdl plan formatter (#299).
- **OpenCode warms the daemon on plan-agent activity.** Messaging the Plan agent now
    brings the daemon up before you submit, the analog of Claude Code's `EnterPlanMode`
    prewarm, so the first review doesn't pay the cold-spawn cost (#298).

### Changed

- **One way in.** `bunx --no-cache @macintacos/caret@latest install` is now the only
    documented install path. `scripts/install.sh` is deleted and its dev loop moved into
    `caret install --from-local`, so `mise run build --install` and Claude Code's hooks go
    through the same entrypoint; the per-agent plugin mechanics moved out of the README
    into `doc/ADVANCED.md` (#300, #301).
- **A failed install target exits non-zero.** Installing no longer closes with a success
    line when a target actually failed (#300).
- **The keyboard and preference layers each got a single source.** A shortcut's key now
    comes only from `CANONICAL_KEYMAP` (buttons derive `aria-keyshortcuts` from it), the
    plan's search HUD, vim cursor, and visual-select moved into one `planKeyboard`
    factory, browser prefs self-register their storage keys, and the unsent-comment
    controller now lives in the parent both consumers share. No behavior change
    (#294, #295, #296, #297).

### Fixed

- **The theme preview lands in the right place when you reopen the picker quickly.**
    Reopening the theme select before the previous preview settled could leave the preview
    misplaced (5fc0bf1).
- **`mise run dev --fresh` clears the drag-hint dismissal.** That key had drifted out of
    the reset list, so the hint stayed dismissed across a fresh run (#294).

## v0.7.2

Released 2026-07-23 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.7.2)

caret 0.7.2 moves settings into a dedicated two-pane surface with a Notifications pane, an
Advanced pane surfacing read-only daemon and install diagnostics, a live theme preview,
and /-to-focus search across every setting. It also scopes keyboard shortcuts to the
active view and collapses the shortcuts help to a single column.

### Added

- **A dedicated settings surface.** Settings became a two-pane shell — a navigation rail
    beside a content pane — with every setting backed by a shared registry (#284, #286).
- **Notifications settings pane.** Notification preferences moved into their own pane in
    the new settings surface (#287).
- **Advanced pane with read-only diagnostics.** An Advanced pane surfaces daemon and
    install diagnostics for troubleshooting, without exposing anything editable
    (#285, #288).
- **Live theme preview.** Themes now preview on an abstract interface skeleton, so you
    can see a theme before committing to it (#289).
- **Search your settings.** A settings search field with `/`-to-focus jumps straight to
    a setting by name (#290).

### Changed

- **Shortcuts scope to the active view.** Keyboard shortcuts now bind to whichever view
    is focused, and the shortcuts help collapsed to a single column; a cohesion and
    keyboard-flow pass tightened the settings surface throughout (#291, #292).

## v0.7.1

Released 2026-07-21 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.7.1)

caret 0.7.1 adds pointer affordances across the review surface: file references highlight
as you hover and open their preview on click, the working-directory path copies on click,
and the Request Changes and Approval comment fields became live-markdown editors that
style prose as you type. It also keeps the hover state current when you scroll with the
cursor held still, and moves plan formatting onto a locally downloaded rumdl binary.

### Added

- **Click the working-directory path to copy it.** The working-directory path on the
    compare row is now click-to-copy, backed by a new reusable in-UI alert surface that
    confirms the copy (#282).
- **File references open their preview on click.** A filename reference in the plan now
    highlights as you hover it, and clicking it opens the file preview (#281).
- **Live-markdown comment editing.** The Request Changes and Approval comment fields
    became live-markdown editors that style your prose as you type (#280).

### Changed

- **Hover keeps up with a stationary cursor on scroll.** Scrolling with the pointer held
    still now re-resolves the hover state to whatever moves under the cursor, so the row
    highlight and file preview no longer go stale (#279).
- **rumdl formats plans locally.** Plan formatting now downloads and runs a pinned rumdl
    binary rather than relying on an ambient install, and that binary was bumped to 0.2.37
    (#278, 06a589f).
- **Aligned Kbd keycap glyphs.** The `Kbd` keycap was lowered so its glyph sits on the
    paired label's baseline (872823b).

## v0.7.0

Released 2026-07-20 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.7.0)

caret 0.7.0 makes the review surface operable from the keyboard end to end: a shortcut
registry and dispatcher, vim-style motion and / search over the plan, commenting on the
focused line, and a help modal plus status bar that surface every shortcut. It also
polishes the chrome — flatter GitHub-style keycaps, a softer focus ring, and Esc now
clears the plan's line cursor instead of leaving it stranded.

### Added

- **Keyboard-driven review.** The review surface became operable from the keyboard end
    to end. A shortcut registry and global dispatcher landed as the foundation (#263),
    then a focused-line cursor with vim-style motion over the plan (#266), keyboard
    shortcuts for the review actions and chrome (#267), commenting on the focused line
    without reaching for the mouse (#268), and keyboard navigation through the comment
    viewer (#270).
- **Shortcuts help modal and status bar.** A help modal lists every shortcut and a
    bottom status bar surfaces the ones in reach (#264). `cmd+enter` confirms the
    approve/reject dialog (e24567c), and `\` toggles the sidebar (#271).
- **Vim-style `/` search over the plan.** Press `/` to search the plan text and jump
    between matches, the way you would in vim (#274).
- **Toggle for shortcut hints.** A settings toggle shows or hides the inline shortcut
    hints (#269), and the compare toggle now advertises its `d` shortcut (f65a322).

### Changed

- **Redesigned shortcuts help modal.** The help modal was reworked wider and
    multi-column, with `/`-to-search across the shortcut list (#276).
- **Keycaps flattened toward GitHub's look.** The `Kbd` keycaps were flattened toward
    GitHub's style (82a10e9), letter caps now render as capitals (#272), and `Shift`
    renders as an icon (e39a071).
- **Softer review chrome.** The focus ring was softened to a subtle accent (8986fc9),
    the approve split-button seam tightened (393c944), and the review confirm-dialog
    widths were widened and unified (#265).
- **Styled links and a marked dev tab.** Links got a light styling pass (fa813f1), and
    the dev tab is now marked with a carrot favicon (ab042be).
- **Developer tooling.** `app.css` was split into `styles/` partials (fc6edfa), long
    shadcn class strings were grouped into commented, concern-grouped chunks (#273), and
    missing component purpose headers plus a `longPoll` null-return doc were filled in
    (decb393).

### Fixed

- **Esc resets the plan line cursor.** Pressing Esc now clears the focused-line cursor
    in the plan, which it previously left stranded (#275).

## v0.6.0

Released 2026-07-18 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.6.0)

caret 0.6.0 reworks the review UI to stay usable at narrow widths — the whole surface
reflows so caret fits docked in a slim column beside your editor, with the TopBar controls
consolidated, the version-compare bar and diff layout responsive, pinned chrome stacked,
and dialogs and overlays fit to the narrower frame. It also adds a collapsible
table-of-contents rail that folds away when space is tight and an icon on the Compare
versions button.

### Added

- **Collapsible table-of-contents rail.** The plan's table of contents became a
    collapsible rail that folds away at narrow widths, reclaiming reading room when the
    review surface is docked in a slim column (#256).
- **Icon on the Compare versions button.** The Compare versions button now carries an
    icon (#255).

### Changed

- **Responsive review UI at narrow widths.** The review surface was reworked to stay
    usable at narrow widths, so caret fits docked in a slim column beside your editor. A
    narrow-width audit and the width foundation landed first (#253), then each region was
    reshaped in turn: the working-directory path moved onto the compare row (#254), the
    TopBar controls consolidated (#257), the version-compare bar and diff layout went
    responsive (#258), the pinned chrome now stacks (#259), and dialogs and overlays fit
    to narrow widths (#260) — closed out by a cohesion pass and an end-to-end regression
    guarding the narrow-width behavior (#261).
- **Adjusted demo plan.** The `/caret:demo` plan's contents were tweaked (0dec29b).
- **Developer tooling.** `mise run format` gained a Tailwind canonical-class step
    (a16e3f8), and a `ui/package.json` stub lets shadcn-svelte's CLI run (1d0fa2c).

## v0.5.0

Released 2026-07-16 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.5.0)

caret 0.5.0 rolls out the welcome mat: first-run onboarding, a notification bell that
signals when a plan is waiting and clears once you open it, and a confirmation step before
you approve. A round of review-surface polish — steadier hover previews, a refined inline
comment card, warmer light-theme greys, and room to scroll past the end of a plan — rounds
it out.

### Added

- **First-run onboarding and notification bell states.** A new reviewer is greeted by a
    first-run onboarding dialog, and the notification bell now carries explicit states —
    idle versus a dot that draws attention when a plan is waiting. Local dev gained a
    `--fresh` boot that isolates its config so onboarding and preferences can be exercised
    from a clean slate (#246).
- **Confirm before approving.** Approving a plan now asks for confirmation first through
    a modal, so a stray click can't ship an approval you didn't mean (#247).
- **Scroll past the end of the plan.** The plan view now lets you scroll beyond the last
    line, so the bottom of a plan no longer sits pinned against the window edge while you
    read or comment (#245).

### Changed

- **Notifications clear when you open their plan.** Opening a plan now dismisses its
    lingering desktop notification, so the bell and your notification tray stay in sync
    with what you've actually looked at (#251).
- **Steadier file-preview hover.** The filename-reference hover preview gained a
    trajectory grace period, so the preview no longer flickers away when your pointer
    briefly clips its edge on the way in (#244).
- **Refined inline comment card.** Inline comment cards now render their prose in
    sans-serif, focus the edit caret when you start editing, and keep their actions
    collapsed until you need them (#250).
- **Warmer light theme.** The caret light theme's neutral greys were warmed for a
    softer, less clinical reading surface (#249).
- **Installer shows the version.** `install.sh` now prints the caret version at the
    start and finish of a run (7e40db1).
- **src/ reorganized into domain directories.** The flat `src/` tree was reorganized
    into domain directories, with the layout docs rewritten to describe each directory by
    purpose rather than by file list (#242, #243).
- **Adopted the `@/` import alias.** The codebase moved onto the `@/` import alias and
    turned on Biome's import organization (#248).
- **Looser tool pins.** The mise tool pins were loosened and the lockfile refreshed
    (#241).
- **README hero screenshot.** The README now leads with a review-UI hero screenshot
    (#240).
- **Reflowed release notes.** GitHub Release notes are reflowed to single-line
    paragraphs and prefaced with a short summary, and the release code was relocated
    alongside the rest of the tasks CLI (#239).

## v0.4.1

Released 2026-07-15 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.4.1)

### Fixed

- **OpenCode install resolves the latest caret every time.**
    `caret install --target opencode`, and the manual install commands documented in the
    README, now run `bunx` with `--no-cache` — forcing a fresh `@latest` resolution so a
    stale bunx cache can no longer pin the install to an older published version.

## v0.4.0

Released 2026-07-15 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.4.0)

### Added

- **OpenCode plugin-array install.** caret now installs into OpenCode as a first-class
    npm plugin: a bare `plugin: ["@macintacos/caret"]` entry in the OpenCode config, with
    `caret install --target opencode` editing that array (comment-preserving) while
    OpenCode fetches the published package itself. The plugin resolves its own binary and
    version at runtime, so it works when loaded straight from npm (#236).
- **Startup update nudge for OpenCode.** On load, the OpenCode plugin checks caret's
    latest GitHub release and toasts a nudge when your install is behind — best-effort and
    silent on error, with a `CARET_OPENCODE_NO_UPDATE_CHECK` opt-out (#236).

### Changed

- **Unified install command.** `caret install-opencode` is replaced by
    `caret install --target <opencode,claude,both>` (with `--uninstall` and `--dry-run`
    retained); the `claude` target drives the `claude` plugin CLI to add, install, and
    enable the marketplace plugin (#236).

### Removed

- **OpenCode plugin file-deploy machinery.** The old file-deploy install path — copying
    plugin files, writing a config-dir `package.json` manifest, and stripping non-default
    exports — is retired now that OpenCode installs the single published package directly
    (#236).

## v0.3.0

Released 2026-07-14 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.3.0)

### Added

- **Color palettes and theme switching.** The review UI now supports selectable color
    palettes and switching between themes, with the diff view's syntax colors following
    the active theme (#218).
- **Confirm before dropping inline comments.** Discarding or deleting an inline comment
    now asks for confirmation first, so a stray click can't silently drop an in-progress
    annotation (#219).

### Changed

- **UI rebuilt on shadcn-svelte.** The review UI's component layer was migrated onto a
    Tailwind v4 + shadcn-svelte foundation, with caret's theme tokens bridged into the
    shadcn token system and a shadcn-first composition rule added for contributors. The
    TopBar cluster, the Settings and confirm-guard modals, the Request Changes dialog, the
    status and ambient chrome, the version-compare picker, the inline-annotation surfaces
    (Card, Button, Badge), and SourceToc/CodeCopyButton/FilePreview were all rebuilt on
    shadcn primitives, closed out by a cohesion pass that retired the bespoke CSS the
    migration superseded
    (#220, #221, #222, #223, #226, #228, #230, #231, #232, #233, #234).
- **Consolidated preference storage.** The duplicated localStorage enum-preference
    modules were collapsed into a single shared helper (#217).
- **Bug reports point at the discovery command.** The README's bug-reporting section now
    directs you to the `/caret:discovery` slash command for a diagnostics snapshot (#227).

### Fixed

- **Comment composer caret jump.** The inline comment composer no longer jumps the caret
    to the wrong position when you switch the line it's anchored to (#229).

## v0.2.0

Released 2026-07-12 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.2.0)

### Added

- **Reject decision.** A Reject button in the review top bar rounds out the decision set
    alongside Approve and Request Changes (#214).
- **Persistent inline comment scratches.** Uncommitted inline-comment scratches now
    persist across reloads, scoped to the plan version, so in-progress annotations survive
    a refresh or a new plan version (#209).
- **Discard affordance for the inline composer.** The inline comment composer gained an
    explicit control to discard a draft (#212).
- **Filename-reference hovering.** Filename references in the plan view are now
    intelligently hoverable (#201).
- **Agent-interface plan reconciliation.** Plan decisions made directly in the agent's
    own interface are reconciled back into caret's review state (#195).

### Changed

- **Unified tasks CLI.** The remaining mise file tasks were consolidated into a single
    tasks CLI: build/test/smoke collapsed into single tasks, the release CLI merged in,
    raw args passed through the mise file tasks, and the preflight gate moved into the CLI
    — plus dev-task follow-ups (in-process driver, testable supervision, flags)
    (#203, #204, #206, #207, #208, #213).
- **Release prepare no longer preflights.** The preflight gate was removed from the
    release prepare step (a758a5e).
- **Unsent-comment guardrails.** The approve "are you sure?" guard now previews the
    unsent comments it is about to drop and counts unsent inline scratches toward the
    pending total (#210, #215).
- **Distinct, scrollable plan code blocks.** Code blocks get a distinct panel styling in
    the plan view and scroll horizontally when wide (#198, #200).
- **Leaner OpenCode change-request output.** OpenCode change-request tool results no
    longer re-paste the full plan (#196).
- **Documented the review timeout.** Added an explanation of why the caret review
    timeout exists (#194).

### Fixed

- **Visible Save/Discard in Request Changes.** Unsent-scratch Save/Discard controls
    stayed hidden inside a collapsed disclosure in Request Changes; they are now always
    visible (#211).
- **Deduped plan-review notifications.** Desktop plan-review notifications no longer
    fire once per open tab (#202).
- **Cleared lingering OpenCode review link.** The OpenCode review-link line is now
    cleared after a plan decision (#197).

## v0.1.3

Released 2026-07-07 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.1.3)

### Fixed

- **Plan approval on Claude Code 2.1.199+.** Newer Claude Code (≥2.1.199) silently
    discarded caret's plan-approval decision unless it echoed the plan tool's input back,
    so clicking Approve did nothing while Request Changes still worked. caret now returns
    the plan's tool input alongside its allow decision, restoring the Approve action on
    current Claude Code (#192).

## v0.1.2

Released 2026-06-23 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.1.2)

### Changed

- **Single-gate release flow.** The `/release-caret` skill now asks for exactly one
    confirmation — the script-computed version — and accepting it authorizes the entire
    run end-to-end: opening the release PR, merging it, tagging trunk, and publishing the
    GitHub Release and npm. The previous separate remote-mutation prompt is gone (#190).

## v0.1.1

Released 2026-06-23 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.1.1)

### Changed

- **Leaner README.** The README is now a lean front door — what caret is, install, basic
    usage, and pointers — with the deep material (architecture, adapters, the full
    config/env tables, dev workflow, and logging) moved to `doc/ADVANCED.md` (#186).
- **Documentation routing reference.** Docs are reorganized around a routing reference:
    `docs/` is merged into `doc/`, a documentation map is added under `doc/agents/`, and a
    minimal `CONTRIBUTING.md` is introduced (#184).
- Comment quotes sent back to the agent as deny feedback are now abbreviated to the
    selection's first and last few words around an ellipsis instead of the full text — the
    agent already has the plan and line numbers, so the full quote wasted tokens (#188).

### Fixed

- **OpenCode plugin deployment.** caret now deploys its OpenCode plugin into the
    canonical plural `plugins/` directory instead of the backwards-compatibility `plugin/`
    alias (#185).
- **OpenCode command deployment.** caret now deploys its OpenCode commands into the
    canonical plural `commands/` directory instead of the backwards-compatibility
    `command/` alias (#187).

## v0.1.0

Released 2026-06-18 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.1.0)

### Added

- **Rebuilt plan-review surface.** Plans now render through a new source view built on
    `@pierre/diffs`, with caret's theme, fonts, and color palette bridged into the diff
    view (#119, #122, #125).
- **Inline annotations.** Line-anchored comments, created from the line gutter or by
    dragging across the code body, appear as scroll-synced inline cards framed as ordered
    per-line threads, with a host-side bracket spanning each comment's line range
    (#121, #126, #129, #146, #147, #150, #172).
- **Markdown comment composer** with live styling, auto-grow, and rendered comments
    (#174).
- **Version compare.** A version picker, side-by-side diff, layout toggle, sticky
    compare header with caret-tied counts, and classic `+`/`-` diff indicators
    (#128, #153, #155).
- **Filterable table of contents** for the source view, with per-level indent guides and
    per-heading deep-linking by header slug (#127, #160, #161).
- **Clickable links** in the source view, with a caret-themed link-hover tooltip
    (#123, #162).
- **Returnable comment drafts.** An unsaved comment draft is kept as a Resume marker,
    and unsaved scratches surface in Request Changes with Save or Discard (#169, #170).
- **Pending-comment guardrails.** The pending-comment count is surfaced before submit,
    and approve is guarded while inline comments are still pending (#148, #149).
- **Reader affordances** — line-wrap and hide-line-numbers toggles (#152).
- **Persistent plan-review status strip** pinned as a fixed root sibling (#165).
- **OpenCode support.** caret now drives OpenCode through its adapter registry,
    alongside Claude Code and Codex (#179).
- **GitHub-based plugin installation.** The plugin now publishes to npm so
    `/plugin marketplace add macintacos/caret` resolves the latest version (#178).
- **Feedback cites line numbers** with quoted lines in submitted reviews (#124).
- A `run-caret` skill that launches local dev and opens the review UI (#167).
- Plans are formatted with prettier at version ingest (#118).

### Changed

- **Design-token system.** Motion tokens with a global reduced-motion rule, a named
    numeric type scale with tabular figures, and the diff surface's add/delete colors and
    layered styling tied to caret's palette
    (#140, #141, #142, #143, #144, #145, #156, #157, #158, #159).
- **Cut over to the new review surface and removed the legacy one** (#130).
- **Restyled chrome.** The shell, EmptyState, and TopBar/badges were reseated onto the
    shared chrome and foundation tokens in the diffs design language (#131, #164, #166).
- Wide-ranging plan-review polish across selection, gutter, table of contents, status
    pills, the compare header, collapsed-context bands, per-comment state, and hover
    affordances (#151, #154, #168, #173, #176, #181).
- All Shiki languages are now highlighted in plan review (#182).
- The install output is consolidated into one animated section (#180).
- **Leaner UI bundle** from a bundle-impact audit and Shiki slimming (#133).
- Preflight is now interruption-safe and concurrency-bounded (#138).

### Fixed

- Plan-review rendering and interaction fixes — scroll jump, fenced highlighting,
    plan-file sync, inline comments, and table-of-contents scroll accuracy
    (#134, #135, #136).
- The off-by-one table-of-contents active-heading highlight is corrected (#175).
- An orphaned decision-registry entry is cleared on a revision resubmit (#139).

## v0.0.5

Released 2026-06-12 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.0.5)

### Added

- **Build version badge.** The running build's version now shows in a bottom-left UI
    badge, so you can tell at a glance which build you're reviewing against (#109).
- **Machine-readable preflight.** `mise run preflight` accepts a `--json` flag that
    emits compact `start` and `result` documents for tooling and agents instead of the
    live human display (#113).

### Changed

- **Build-gated dev settings.** Development-only settings are consolidated into a single
    `[dev]` config section gated to non-release builds, so dev-only behavior can't leak
    into a released build (#115).
- **Gated dev seeder.** The `mise run dev` extra-review seeder is now off by default,
    fired only behind an explicit `--notify` flag (#106).
- The end-to-end test suite moved into `test/e2e` (#112).

### Fixed

- **Notifications on the installed build.** New-plan desktop notifications now fire on
    the installed build, not just during local development (#110).
- **Reliable tab presence.** UI tab-presence detection is now robust to browser
    background throttling, so presence isn't lost when the tab is backgrounded (#114).
- Markdown links are stripped from the titlebar post title, so it renders as clean text
    (#111).

## v0.0.4

Released 2026-06-09 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.0.4)

### Added

- **Codex support.** caret now drives OpenAI Codex alongside Claude Code, selected
    through a pluggable adapter registry — the core/adapter seam proven with a real second
    agent (#58, #71, #87, #89).
- **Desktop notifications** for new plans, with a permission bell badge in the UI (#49).
- **Multiple concurrent daemons**, so separate projects can each run their own review
    session at the same time (#45).
- **Configuration file.** A `config.toml` and settings service unify every `CARET_*`
    environment variable under one place (#27, #39).
- **Leveled logging.** Info-level-by-default logs with redaction of identifiable data so
    logs are shareable, caller location on every record, the runtime commit logged at
    startup, and a browser-UI → daemon log bridge (#28, #30, #35, #40, #41).
- **Discovery diagnostics.** A `caret` diagnostics command surfaces how caret detected —
    or failed to detect — your agent and install (#47).
- **Vanity origin.** The review UI opens under `caret.localhost` instead of a bare
    localhost port (#48).
- **Persistent draft.** The "Request Changes" general-comment draft is now saved per
    review (#22).
- Logging and configuration docs: a README "Logging & Debugging" section, `config.toml`
    documentation, and checked-in contributor rules for logging conventions and settings
    (#31).
- A `--install` flag for `mise run build` (#105).

### Changed

- **Tool-agnostic core.** The daemon and core were decoupled from Claude-specific
    concepts: an `AgentAdapter` interface owns decision emission, approval variants became
    adapter capabilities, and the daemon's resolve/prefs no longer hard-code Claude mode
    names (#71, #73, #80, #81, #88).
- **UI overhaul.** All iconography is now vendored Lucide SVGs, the typeface stack
    prefers Inter Display, monospace is reserved for code and intentional accents, and the
    plan table-of-contents was redesigned as a hover-expanding tick rail
    (#24, #29, #36, #42, #43).
- **Faster, leaner UI build.** Shiki grammars load as lazy dynamic-import chunks, and
    the UI is embedded as a multi-asset build via a generated manifest (#82, #83).
- Agent rules are now routed through a checked-in `CLAUDE.md` (#107).
- Local dev builds are flagged in the UI so they're distinguishable from released builds
    (#103).
- Preflight runs in parallel behind a live task display (#46).

### Fixed

- Stale pending reviews now expire on hook timeout and resubmit, instead of hanging
    (#37).
- `install.sh` build drift and duplicated UI-fallback copy are corrected (#52).

### Security

- Plan HTML is sanitized last with an explicit DOMPurify allowlist, hardened by an
    adversarial XSS test suite (#90, #92).
- A safe-method CSRF guard and a no-CORS posture protect the daemon's HTTP surface
    (#95).
- State directories are created `0700` and plan JSON `0600`, unified through
    `ensureStateDir` (#94).

## v0.0.3

Released 2026-06-02 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.0.3)

### Added

- A dry-run mode for `install.sh` that previews every action without touching the system
    (#18).

### Changed

- The Approve button now remembers and defaults to the approval method you used last
    (#17).
- Plan code blocks must now carry an explicit language marker, so syntax highlighting is
    never left to guesswork (#19).
- Markdown formatting and linting now run on rumdl instead of prettier — a single native
    binary that both formats and lints, dropping the npm-backed prettier tool and adding
    structural Markdown linting to `mise run lint` (#16).
- The `install.sh` output is polished for clearer, more readable progress (#18).
- The release preflight gate is hardened against silent working-tree drift, so a release
    can no longer slip through on an unexpectedly dirty tree (#15).
- The `/release-caret` flow is hardened with fixes drawn from the v0.0.2 release run
    (#14).

### Fixed

- `release prepare` no longer aborts with a false `DIRTY_TREE` on the changelog it is
    meant to allow — the working-tree scan no longer mangles the first changed path's name
    (#20).

## v0.0.2

Released 2026-06-02 ·
[GitHub release](https://github.com/macintacos/caret/releases/tag/v0.0.2)

### Added

- caret: a local web UI for reviewing and approving Claude Code plans (#1).
- Safe Mode, which ignores accidental in-flight keystrokes so plans aren't approved or
    rejected by stray input (#3).
- Persistent exception logs plus a `/caret:debug` command for inspecting the most recent
    failure (#2).
- Syntax highlighting for code blocks inside plans, powered by shiki (#9).
- A one-command release flow: a deterministic release script paired with the
    `/release-caret` skill (#10).
- Markdown, YAML, TOML, shell, and pkl formatters and linters wired into mise + hk (#4).
- A seeded fake plan for `mise run dev` so the UI has content during local development
    (#7).

### Changed

- The UI now uses the platform sans-serif font, reserving serif for the caret wordmark
    (#5).
- A plan's first heading always renders as an H1, regardless of the level it was
    authored at (#6).
- The installer pulls caret from the latest release tag rather than the default branch
    (#12).
- Preflight now runs its mise tasks directly (#11).
- The README heading sports a carrot emoji (#8).

### Fixed

- Review decisions are delivered via a bounded poll, fixing missed or delayed decision
    delivery.
