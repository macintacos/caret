# caret — Running

*Audience: users running caret day to day — desktop notifications, sound, cmux unread
marks, and logging & debugging.*

Part of the deep reference behind [README.md](../README.md). For what caret is, how to
install it, and basic usage, start there.

## Desktop notifications

### When one fires

A new plan landing while caret is in the background — tab hidden or window unfocused —
fires a desktop notification. Clicking it focuses the tab and opens that review (a
notification click is a user gesture, the one focus path browsers reliably allow).

> [!NOTE]
> Page-context only, no service worker: the tab must be open.

### Where the permission lives

The bell badge in the top bar shows the current permission with a distinct indicator:

| Indicator         | Permission |
| ----------------- | ---------- |
| Green dot         | Granted    |
| Red dot           | Blocked    |
| Subtle-purple "?" | Undecided  |

Clicking the bell requests permission when undecided, and **sends a test notification**
when granted. On a first-ever run, an onboarding modal introduces desktop notifications
and offers to enable them.

The same permission state has a roomier home in **Settings → Notifications**, which reads
it live — On / Blocked / Off for those same three states — with the same enable / test
affordance as the bell. Open Settings from the top-bar button or `,` — a two-pane dialog
you can filter with `/`, and `?` opens the keyboard-shortcuts help from anywhere.

### Where a grant applies

> [!IMPORTANT]
> Grants are **per-origin** (scheme + host + port). The installed build opens the review
> UI at the vanity origin `http://caret.localhost:42718`, a different origin from
> `mise run dev`'s Vite server (`localhost:5173`) — so a grant made in dev does **not**
> carry over.

On the installed build, grant notifications once on `caret.localhost:42718` via the bell —
it shows the undecided "?" state until you do. While the grant stays undecided, a new plan
logs `plan notification skipped (permission)` at info in the daemon log, so a missing
grant is visible without enabling debug logging.

### When no toast appears

If the test click produces no toast, the page's side worked (the daemon log shows the
fired/shown records) and the OS is suppressing it — a granted notification the OS blocks
fails silently, with no error the page can catch. On macOS, check in order:

1. System Settings → Notifications → your browser: "Allow notifications" on, alert style
   not "None".
2. Focus / Do Not Disturb.
3. The "when mirroring or sharing" toggle, if a display is shared.

> [!NOTE]
> A *hidden* tab's poll is throttled by Chrome after ~5 minutes in the background, which
> can delay a notification by up to a minute. An unfocused-but-visible window polls at
> full rate.

## Sound

caret plays a short synthesized cue at the moments worth hearing. News that arrives on its
own: a plan arriving, being revised in place, or expiring; the daemon dropping or coming
back; a verdict going out; a comment posted; a toast firing. Moments you cause while
reading a plan: starting a comment, and discarding or dropping one; the contents popup or
a breadcrumb menu opening; the search HUD opening, committing, stepping between matches,
and closing; entering or leaving visual line-select; switching plans; comparing versions;
showing or hiding the comments panel; the file preview opening or closing; Settings or the
shortcuts help opening; a theme change; and copy-code. None is longer than a fraction of a
second, and none is attached to scrolling, hovering, or pointer movement.

A moment sounds the same however you reach it — the keyboard shortcut and the button play
one cue, because the cue belongs to the action rather than to the key or the click.

**Settings → Sound** holds the switch that silences all of it, plus a **Volume** slider
for how loud the rest play. Sound defaults **on** at a deliberately low 25%; the slider
moves in steps of 5% and applies once you stop moving it, so the confirmation you hear is
already at the level you just set.

> [!NOTE]
> Browsers refuse to start audio until the page has been interacted with, so a tab you
> have never clicked stays silent for its first cue. Desktop notifications cover that case
> — see above.

## Completing a name in feedback

Two characters open a list in any feedback editor — the gutter composer, an annotation
card, the Request changes dialog.

Type `/` at the start of a word and caret offers the skills the agent reviewing this plan
can actually reach, filtering as you keep typing. Choosing one inserts the name in the
exact form that agent needs to see, so a plugin skill arrives namespaced
(`/superpowers:brainstorming`) rather than ambiguous. Each row shows where its skill came
from, which is what tells two sources offering the same bare name apart.

Type `@` and caret offers the files under the working directory the plan was written in,
matched loosely — `@srlbfoo` finds `src/lib/foo.ts`, and each row picks out the characters
your query matched. Choosing one leaves `@` and the cwd-relative path behind as ordinary
text, so the reference still resolves when the agent picks the plan up in some later
session. Type `:42` after the name and the line rides along with it. In a project too
large to search to the end, the list says how much of the answer it is showing.

Either list is walked with the arrow keys or with `tab` and `shift+tab`, and `enter` takes
the highlighted row and leaves a space after it, ready for the next word. Escape dismisses
the list without closing the dialog around it, and a `/` inside ordinary prose — a path
like `src/lib/api.ts` — is left alone.

The `/` list is a **reference** aid: the name becomes part of the feedback the agent
reads, and caret never runs the skill itself. Which skills appear depends on the agent —
Claude Code contributes your own, the reviewed project's, and each enabled plugin's;
OpenCode contributes its commands; codex contributes none, so nothing opens there. The
list is read once when the review opens, so a skill you add mid-review shows up after a
reload.

### Seeing what you are about to cite

With a list open, `ctrl+space` opens a panel beside it showing more about the highlighted
row: a skill's own description, or the opening lines of a file, syntax-coloured in the
theme you are reading in. It sits to the right of the list, or to its left when the
right-hand edge is close, or stacked with it in a window too narrow to hold both side by
side. Stacked, the list moves to whichever side of the line you are typing on has the room
and the panel takes the far side of it, so the two stay together and on screen rather than
the panel ending up at the top of the window on its own. It follows the arrow keys, so
choosing between `src/lib/api.ts` and `src/lib/api.test.ts`, or between `brainstorming`
and `linear-plan`, does not mean leaving the editor to find out which is which. A `:42`
after a filename moves the preview to that line and marks it; a line past the end of the
file says where the file ends.

Opening the panel leaves the row you were on where it was, so you can walk the list and
ask about whatever you land on. A second `ctrl+space` closes it. Whichever way you leave
it is remembered: turn it on and the next list you open — in this review or after a reload
— opens with it. A skill that describes itself nowhere, and a file caret cannot read, each
say so in a sentence and leave the list working.

The top of the list names the shortcut. Turning **Settings → Shortcut hints** off takes
that line away; the shortcut keeps working.

## References caret recognizes

Caret picks filenames out of two places: the plan you are reading, where they become
clickable, and the comment you are writing, where they become chips. Both check what they
find against the working directory the plan was written in, so what you see reflects the
project as it actually is.

### In a plan you are reading

A file the agent cited draws a small icon beside it, and clicking it opens a preview of
that file — the head of it, or a window framed on the lines the reference names, so
`src/mail/send.ts:127-141` opens on 127. A folder opens its tree instead.

Caret picks up two ways of writing one: a path in backticks, and a path in parentheses
beside the symbol it belongs to, the way a plan cites its evidence —
``the retry lives in `attempt_send` (src/mail/send.ts:127-141)``. A path loose in a
sentence is left alone. Backticks and parentheses are how a plan says "this is a path";
reading the rest of the prose the same way would put icons on ordinary words.

A reference that does not resolve stays plain text — no icon, nothing to click. That is
the useful half: a filename the agent invented never looks like one you can open.

### In a comment you are writing

A reference caret can actually resolve wears a soft chip as you type it; one it cannot
stays plain text. That is the signal, not an error — a chip that never appears is how you
catch a misremembered skill name or a path that does not exist, while you can still fix
it. Without it the mistake surfaces only when the plan comes back from the agent.

A `/name` is checked against the skills the reviewing agent really has, the same list `/`
completes from. A path is checked against the working directory the plan was written in,
the same one `@` completes from — and either one re-checks as you edit, so correcting a
typo brings the chip back.

The two kinds are tinted differently — a file or folder green, a skill blue — so a comment
carrying both says at a glance which is which without your having to read them. A path you
completed with `@` wears its `@` inside the chip: the sigil is part of the reference, and
part of what the agent reads.

In prose a path has to carry a `/` or a `.` before caret looks it up, which is what keeps
an ordinary word like `test` from wearing a chip next to a `test/` directory. Wrapping a
name in backticks says "this is a path" outright, so a bare `Makefile` at the top of the
project is recognized that way and not otherwise. The same rule governs the parenthesized
citations above: `(Makefile)` in a plan draws nothing, `` `Makefile` `` does.

The chip is presentation only. What the agent receives is the literal text you typed,
whether or not anything wore one.

## Unread plans

While you read one plan, another can arrive — or the one you read earlier can come back
revised. Neither interrupts you: the plan on screen stays put. What changes is the plan
switcher in the top bar, which grows a small dot beside its count, and opening it shows a
marker on each plan you have not looked at yet.

A plan is marked when it shows up, or gains a new version, while a different plan is
active. Opening it clears its mark, however you got there — picking it from the switcher,
following a link to it, or landing on it after you resolve the plan you were on. The dot
goes dark once nothing is left unmarked.

The marks live in the tab, so a reload starts clean: whatever is pending when the page
opens counts as already seen, not as news. The plan you are reading is never marked, and a
plan that expires or gets resolved takes its mark with it.

> [!NOTE]
> This is not the same thing as § cmux unread marks below, which is about the terminal
> pane your agent runs in rather than the review UI.

## cmux unread marks

Under [cmux](https://github.com/coder/cmux), the pane an agent runs in gets an unread mark
when the agent submits a plan — but the plan is reviewed in the browser, so nothing would
otherwise clear it. caret joins the two ends: at submit time the hook captures its
`CMUX_WORKSPACE_ID` and `CMUX_SURFACE_ID`, and the ids ride along on the review record
(the daemon is long-lived and shared across sessions, so it never inherits any one agent's
environment).

Once the plan is reviewed, the daemon runs
`cmux mark-notification-read --workspace <id> --surface <id>` for that one pane. Two
things count as reviewed, and either clears the mark:

- **You decide on the plan** — approve, reject, or request changes.
- **You read it** — the plan on screen, the tab visible and focused, for 5 seconds
  uninterrupted. Losing focus or hiding the tab cancels the dwell rather than pausing it,
  so a backgrounded tab left open never clears a mark on its own.

Three details worth knowing:

- Both ids are required, and every call names both — caret never uses `--all`, so one
  plan's mark can only ever clear the pane that submitted it.
- There is nothing to configure: with either id missing the integration is silently inert,
  which is what running outside cmux looks like.
- If the `cmux` binary isn't on the daemon's PATH, the mark is left standing and one
  `warn` lands in the daemon log.

## Update notices

The daemon asks whether a newer caret is out (see the README for what that call sends and
how to turn it off in `prefs.json`). An on-demand daemon asks when it starts, a resident
one asks again on an hourly tick, and a 24-hour stamp keeps either to about once a day.
This is what you see when the answer is yes.

A toast arrives on your next page load, and it names the version rather than just saying
one exists. It waits until you read or dismiss it instead of fading, and it appears
**once per version** — the same release never nags you twice, but a newer one gets its own
notice. **View** on the toast opens **Settings → Updates**.

While an update is waiting, a small mark sits on the settings button in the top bar and on
the **Updates** row in the settings rail, so the notice is findable again after you
dismiss it.

The **Updates** pane says which version you are running, which is available, and the exact
command that installs it — the command matches how *this* caret was installed, so a
published install and a locally-built one are told apart for you. There is no update
button: caret tells you what to run, and you run it.

Two readings are not problems, and the pane says so rather than reading like a failure:

- **Nothing to compare against.** A caret built locally carries a commit that isn't on
  trunk, so there is nothing for GitHub to compare it to. On a development machine this is
  the normal daily reading.
- **Update checks are off** — either because caret is running from source, or because you
  turned them off.

The **Check for updates** switch in that pane is the same `updates.check` setting the
README describes, without the file edit. The daemon reads it on every request rather than
only at startup, so turning it off stops the toast and both marks immediately. Turning it
back on asks again on the spot — subject to the same once-a-day throttle as any other
check — and reports the answer on your next load.

## The caret service

Answer **Keep it running** when `caret install` asks (`mise run build --install` included)
and the install registers the caret service: a login service that keeps a resident daemon
— one that stays up until told to stop — on the port, so the review UI it serves is up
before any plan arrives. Windows has no service, and neither does a Linux host without a
systemd user session; there, install says so and caret runs on demand.

|  | macOS | Linux |
| --- | --- | --- |
| **Service** | launchd agent `dev.excessive.caret`, in `~/Library/LaunchAgents/dev.excessive.caret.plist` | systemd user unit `caret.service`, in `~/.config/systemd/user/` |
| **Status** | `launchctl print gui/$(id -u)/dev.excessive.caret` | `systemctl --user status caret.service` |
| **Restart** | `launchctl kickstart -k gui/$(id -u)/dev.excessive.caret` | `systemctl --user restart caret.service` |
| **Stop** | `launchctl bootout gui/$(id -u)/dev.excessive.caret` — stopped until your next login | `systemctl --user stop caret.service` — stopped until your next login, or with lingering your next boot |

On either platform, the daemon reports whether it is resident and which upkeep tasks it
runs (`42718` is `[daemon].port`):

```sh
curl -s http://127.0.0.1:42718/api/diagnostics | jq '{resident, upkeep}'
```

While the service is stopped, the next review starts an on-demand daemon, which exits once
it has sat idle for `[daemon].idle_ms` with no review pending and no review UI tab open.

### What the service runs

Every unit runs `$XDG_STATE_HOME/caret/bin/caret daemon`. That file is
`bin/caret-launcher`, which chooses what to run each time it starts:

- **caret** — the version a `--from-local` build pinned, else the newest one installed
  across Claude Code's plugin cache and OpenCode's package cache.
- **bun** — the one recorded at install, else the first found in `~/.bun/bin`,
  `/opt/homebrew/bin`, `/usr/local/bin`, mise's shims and installs, then `~/.asdf/shims`.

So restarting the service is how its daemon takes an upgrade. `caret install --refresh`
restarts it, and so does the first review from a newer caret unless a local build is
pinned. The daemon also sees only the environment captured at install — see
[Runtime](CONFIGURING.md#runtime).

### When the daemon exits

The supervisor starts it again: launchd after its throttle of about 10 seconds, systemd
after 5. systemd gives up after five starts inside 60 seconds and parks the unit.

When the launcher cannot run anything — no runnable caret, or no bun — it exits with
status 78, and the service stops instead of restarting into the same failure. systemd
honours that status itself; on macOS the launcher boots the agent out, and the plist loads
again at your next login. `caret install` restores it. The launcher's reason lands in
`logs/daemon-stderr.log` (see [Where the logs live](#where-the-logs-live)).

On Linux, install also runs `loginctl enable-linger` so the service outlives your logout.
Some distributions refuse that without admin rights; install then logs
`lingering not enabled; caret stops at logout` and carries on, and caret stops when you
log out.

## Turning caret off

Two commands turn caret off, and they turn off different amounts of it:

| Command | What it does |
| --- | --- |
| `caret install`, answering **I'll run it myself** | Stops caret being resident: the review UI is no longer up from login onward. Your agent still reaches caret, and caret starts on demand. |
| `caret install --uninstall` | Removes caret from every agent, and from this machine. |

Answering **I'll run it myself** removes the service, and the install prints how to bring
the review UI up by hand: `caret serve` keeps it up until you stop it with Ctrl+C (see
[Running caret yourself](../README.md#running-caret-yourself)). The choice isn't saved
anywhere. A later `caret install` at a terminal asks again. One off a terminal can't ask,
so it leaves things as they are: it refreshes a service that is already registered, and
registers none where there isn't one.

> [!IMPORTANT]
> On macOS caret also appears under **System Settings › Login Items**, but that switch is
> neither of these. caret cannot read it, so a later `caret install` that keeps the review
> UI running registers the service again and reports success while the switch still reads
> off. Run `caret install` and answer **I'll run it myself**, or use `--uninstall`,
> instead.

Alongside the agents, `--uninstall` removes the service's unit file, the launcher, and the
records the launcher reads, keeping your prefs and reviews. The launcher removes the same
things itself when it finds no caret installed anywhere, after looking twice more, five
seconds apart. When caret is installed but can't run, it stops the service instead (see
[When the daemon exits](#when-the-daemon-exits)). `caret install` brings back either.

## Logging & Debugging

### Where the logs live

Logs live under `$XDG_STATE_HOME/caret/logs` when set, otherwise
`~/.local/state/caret/logs`:

| File                | What's in it                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `caret.log`         | NDJSON records from the short-lived `caret review` hook process.                                                                    |
| `daemon.log`        | The daemon's records: the same NDJSON shape, tagged with `pid`.                                                            |
| `daemon-stderr.log` | Whatever the daemon writes outside its logger — raw non-JSON crash output — plus `bin/caret-launcher`'s own failures when a supervised start cannot resolve caret or bun. |
| `archive/`          | Gzipped rotations, named `<log>-<stamp>.log.gz`. A log past `[logging].max_size` is archived here and emptied; the newest `[logging].keep` per log are kept. |

Browser-UI events ship to the daemon in batches (`POST /api/logs`) and land in
`daemon.log` tagged `source: "ui"`, subject to the same `[logging]` level and redact
settings as everything else.

### What a record carries

Each record is one JSON object per line (pino):

| Field    | Value                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| `level`  | Numeric — 20 debug, 30 info, 40 warn, 50 error.                                                           |
| `time`   | ISO 8601 UTC, e.g. `2026-06-04T21:25:40.038Z`.                                                            |
| `step`   | A short fixed token.                                                                                      |
| `source` | The emitting process — `"hook"`, `"daemon"`, or `"ui"`.                                                   |
| `caller` | The `file:line` of the emitting call site. On hook and daemon records only; bridged UI records omit it.    |

Every record also carries `msg`, plus structured extras. Normal operation logs at info;
only genuine failures sit at error.

> [!TIP]
> To raise verbosity, set `level = "debug"` in `config.toml`'s `[logging]` table (see
> [Config file](CONFIGURING.md#config-file)). It hot-reloads — no restart needed.

### Diagnostics

- `/caret:debug` — the slash command that reviews the current session —
  pending/approved/rejected/expired plans (from the on-disk review records) plus recent
  errors from the live logs — and helps debug failures.
- `caret redact` — scrubs the three live logs, not the archives, into shareable
  `*.redacted.log` siblings (home paths become `~`, usernames in foreign home paths are
  censored). For always-on scrubbing at write time, set `redact = true` in `[logging]`.
  Plan, prompt, and review-feedback bodies are never written to logs regardless of the
  toggle.
- `caret discovery` — a one-shot, read-only diagnostics snapshot of the local install —
  running caret processes, daemon identity (version, build, startup commit), lock/port
  state, effective settings, review counts, the agent adapter's install-state probe, log
  sizes and error/warn counts, install/runtime info, and system basics. Human-readable by
  default; `caret discovery --json` prints the same report as one JSON document (schema
  marker `caret-discovery/1`). Unlike the logs, the report is **always redacted** — it
  exists to be shared — and it never contains plan/prompt/feedback bodies or log contents.
  Probes are individually bounded and degrade per-section, so the command exits 0 even
  when the daemon is down.
- `/caret:discovery` — the slash command that wraps it: asks whether you want JSON or
  human-readable output, runs the subcommand, and ends with the report in a code block
  ready to share. Complements `/caret:debug` (the session timeline): discovery is the
  point-in-time snapshot of the installation.

Contributors should see `agents/logging-rules.md` for the logging conventions — when to
log, levels, and message style.
