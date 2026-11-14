# Get notified about plans

*Audience: anyone who wants to know when a plan is waiting, or to quiet that signal.*

This page covers the ways caret tells you a plan is waiting: desktop notifications, sound,
unread markers in the plan switcher, a waiting-plan signal in your agent host, and cmux
unread marks.

## Turn on desktop notifications

1. Open the [review page](../reference/glossary.md#review-page) at
   <http://caret.localhost:42718>, where the installed caret opens it.
2. Click the bell in the top bar while it shows "?".
3. Allow notifications when your browser asks.
4. Click the bell again to send a test notification.

When a new plan arrives while caret's tab is hidden or its window unfocused, caret shows a
desktop notification. Click the notification to focus the tab and open that
[review](../reference/glossary.md#review). Notifications need the review page open in a
tab.

The bell shows whether your browser lets caret notify you:

| Indicator         | Permission |
| ----------------- | ---------- |
| Green dot         | Granted    |
| Red dot           | Blocked    |
| Subtle-purple "?" | Undecided  |

The first time you run caret, a welcome dialog offers to turn notifications on.

**Settings → Notifications** shows the same permission as On, Blocked, or Off (undecided),
with the same enable and test buttons as the bell. Open Settings from the top-bar button
or with `,`. Press `/` in Settings to filter it, and `?` anywhere to open the keyboard
shortcuts.

Your browser keeps a grant for one address: scheme, host, and port together. If you open
the review page at another address, grant it there too.

## Fix a missing notification

If the bell's test click shows nothing, caret sent the notification and your operating
system hid it; the background service's log records it as fired and shown. The system
gives the page no error when it does this. On macOS, check in order:

1. **System Settings → Notifications →** your browser: **Allow notifications** is on, and
   the alert style is not **None**.
2. macOS Focus or Do Not Disturb.
3. The "when mirroring or sharing" toggle, if you are sharing a display.

While permission is undecided, each new plan writes
`plan notification skipped (permission)` to the
[background service's log](https://github.com/macintacos/caret/blob/main/docs/RUNNING.md#where-the-logs-live),
so a missing grant shows there without turning on debug logging.

In Chrome, a notification for a tab hidden for over 5 minutes can arrive up to a minute
late, because Chrome slows a hidden tab's checks for new plans. Keep the window visible,
even unfocused, to get notifications on time.

## Turn the sound off or down

Open **Settings → Sound**. Turn off the **Sounds** switch to silence caret, or drag the
**Volume** slider to set how loud it plays. Sound is on by default at 25%. The slider
moves in steps of 5% and applies once you stop moving it, so the sound you hear is at the
new level.

caret plays a short sound at these moments:

- News that arrives on its own: a plan arriving, being revised, or expiring; the
  [background service](../reference/glossary.md#background-service) dropping or coming
  back; a decision going out; a comment posted; a notice appearing.
- Things you do while reading: starting, discarding, or dropping a comment; opening the
    outline's filter or a breadcrumb menu; opening, committing, stepping through, and
    closing search; entering or leaving line selection; switching plans; comparing
    versions; showing or hiding the comments panel; opening or closing a file preview;
    opening Settings or the shortcuts help; changing the theme; and copying code.
- On the waiting screen, clicking its `^` key or typing `^` to show the next carrot
    fact, the line of trivia at its foot.

Each sound lasts a fraction of a second. Scrolling, hovering, and moving the pointer make
no sound. A keyboard shortcut and its button play the same sound.

Browsers play no sound until you have clicked in the page, so a tab you have never clicked
stays silent for its first sound. A desktop notification still reaches you then.

## Find plans you have not read

A plan that arrives, or gains a new [version](../reference/glossary.md#version), while you
read another one does not interrupt you. Instead, the
[plan switcher](../reference/glossary.md#plan-switcher) in the top bar shows a small dot
beside its count. Open the switcher to see a marker on each plan you have not looked at.

Opening a plan clears its marker, whether you pick it from the switcher, follow a link to
it, or land on it after you finish the plan you were on. The dot goes away once no marked
plans are left.

The plan you are reading is never marked. A plan that expires or is decided loses its
marker. Markers live in the tab, so reloading the page clears them all: plans already
waiting when the page opens count as seen.

These markers are separate from cmux's marks on your terminal pane; see
[Clear cmux unread marks](#clear-cmux-unread-marks).

## See a waiting plan in your agent host

Each [agent host](../reference/glossary.md#agent-host) shows a waiting plan in its own
way.

### Claude Code

While a plan waits for review, Claude Code shows a 🥕 band above its prompt, so the
session does not look idle. The band needs Claude Code 2.1.287 or later. It shows in the
terminal and the Desktop app, not in VS Code. It clears once you approve, reject, or
request changes, or the review is interrupted or times out.

The band links to this session's waiting review. Click the link, or press `1` in an empty
prompt, to open it in your browser. Either way, caret builds the address, so it follows
your port and login token.

To turn the band off, turn off the **Plan-waiting band** switch in
**Settings → Notifications**, or set `[review] band = false` in `config.toml` (see
[The `[review]` table](../reference/config-file.md#the-daemon-and-review-tables)).
The change applies from the next review; a band already showing stays until its review
ends. Claude Code's `disableAllHooks` and `--safe-mode` also turn it off.

### OpenCode

On OpenCode v2, `ctrl+x p` opens the waiting plan; see
[Install caret § OpenCode](install.md#opencode).

### pi

pi shows a notice above the editor and `^ plan waiting` in its footer, and `ctrl+alt+o`
opens the plan; see [Install caret § pi](install.md#pi).

## Clear cmux unread marks

Under [cmux](https://github.com/manaflow-ai/cmux), the pane your agent runs in gets an
unread mark when the agent sends a plan. caret clears that mark once you have reviewed the
plan, in every agent host. Either of these counts as reviewed:

- You decide on the plan: approve, reject, or request changes.
- You read it: the plan is on screen, with the tab visible and focused, for 5 seconds in
    a row. Hiding the tab or leaving the window starts the count over, so a tab left open
    in the background never clears a mark.

Only the pane that sent the plan is cleared. There is nothing to set up, and outside cmux
nothing happens. The `cmux` command must be on the PATH the background service runs with.
If it is not, the mark stays and the background service's log records a warning.

## Next steps

- Read a waiting plan with [Read a plan](read-a-plan.md).
- Comment on it with [Write feedback](write-feedback.md).
