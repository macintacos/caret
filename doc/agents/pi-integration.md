# pi Integration

*Audience: coding agents and contributors changing caret's pi support.*

Load this when working on caret's pi support — the adapter (`src/adapters/pi/`), the
extension (`pi/`), or the install path (`caret install`'s pi target).

## The headline: pi is plugin-shaped — an in-process extension

**pi loads caret as an in-process extension, not a command hook.** pi loads `pi/caret.ts`
through jiti on Node, from `package.json`'s `pi.extensions`. pi has no plan hook and, by
design, no plan mode, so caret adds a review tool in place of the hook, plus a small
planning mode. The adapter (`src/adapters/pi/`) only reads pi's version and settings, for
`caret install` and `caret doctor`.

pi's `[Extensions]` list shows the entry as `caret.ts`, because pi names an extension
after its entry file. Listing it as `caret` would need a `pi/caret/index.ts` entry
instead.

## The bridge: the tool spawns `caret review`

**`caret_review_plan` reuses the review bridge.** The tool (`pi/tool.ts`) calls
`runReviewViaCaret` from `bridge/review-bridge.ts` with `agent: "pi"`. The envelope
carries the session id, the cwd, and `planFilePath`. The binary comes from
`resolveCaretBin`, with `CARET_PI_BIN` as the override.

- The tool takes an optional `plan`, or a `path` (preferred): a `.md` file, absolute or
  relative to the session directory. A leading `@` is stripped.
- The tool adds only its one-line `promptSnippet` to the `<tools>` section of pi's system
  prompt. It sets no `promptGuidelines`: pi would add those rule bullets whenever the tool
  is active, and outside planning mode, users get no behaviour change they didn't ask for.
- The extension warms the daemon from `before_agent_start`, and only while planning.

**The review blocks.** pi has no tool timeout, and the tool runs with
`executionMode: "sequential"`. Plannotator, another pi plan-review extension, went
non-blocking only so users could chat mid-review, which caret doesn't offer.

## The pi APIs it uses and the 1.5.0 floor

**Each `pi/` module exports the slice of pi's API it calls as a type** (`PlanningApi`,
`NoticeApi`, `DemoApi`, `DoctorApi`). `PiApi` in `pi/caret.ts` intersects them, and
`test/pi/sdk-conformance.ts` pins each against the installed SDK. A new pi API goes in its
module's slice first.

**The floor is pi `1.5.0`.** It is the version tested, and the first release published as
`@earendil-works/pi-coding-agent` after the rename from `@mariozechner/pi-coding-agent`
(`src/adapters/pi/host.ts`). `pi/caret.ts` repeats the floor because `pi/` can't import
`src/`, and `test/pi/caret.test.ts` pins the two equal. Below the floor the extension
registers nothing and warns once.

## Packaging

**pi supplies its own packages at load time.** pi's host packages are host-provided, so
the ones caret imports are devDependencies only.
[`dependency-rules.md`](dependency-rules.md) holds the gate.

**There are no `peerDependencies`.** OpenCode's installer would download them, and pi
already supplies them.

**`pi/` imports one caret module, `bridge/review-bridge.ts`**, beside node builtins, the
host packages, and its own siblings. `test/structure/pi-package.test.ts` gates the shipped
closure: everything reached ships under `files` and uses no Bun API. Keep
`keywords: ["pi-package"]`: pi's package gallery lists caret by it.

## Shared state: `pi/state.ts`

**One per-session store backs the tool, the notice, and planning.** Per session it holds
the waiting review's URL, a `planning` flag, and the last outcome (approved, changes,
cancelled, or failed). The notice and planning consume the store and never redefine it.

- The data lives on `globalThis` under `Symbol.for("caret.pi.reviews.v1")`, because
  `/reload` loads a fresh module instance. The stored shape is a cross-version contract,
  so bump the key when it changes.
- The listener set outlives `/reload` too, so subscribers unsubscribe on
  `session_shutdown`. A listener's throw is swallowed.
- A second key, `Symbol.for("caret.pi.owner")`, stops caret loading twice. The second copy
  stays off and warns "caret is loaded twice…".

## Install and upgrade go through pi's CLI

**`caret install` never writes pi's `settings.json`.** It runs only `pi install`,
`pi update npm:@macintacos/caret`, and `pi remove` (`src/commands/install/pi.ts`). A bare
`pi update` updates pi itself.

- It keeps one caret: it removes local-checkout entries and leaves a pinned npm entry
  alone. Under `--from-local` it keeps only this checkout's entry.
- It manages only the user scope. `caret install` and `caret doctor` read only
  `<agentDir>/settings.json`, where agentDir is `PI_CODING_AGENT_DIR` or `~/.pi/agent`. A
  project-scope `pi install -l` is ignored.
- The service launcher (`bin/caret-launcher`) looks only in `~/.pi/agent`.

The summary for readers outside the adapter is in
[`../ARCHITECTURE.md#the-pi-adapter`](../ARCHITECTURE.md#the-pi-adapter).

## The `/caret` command: `pi/command.ts`

**One `/caret` command routes its trimmed argument.** `parseCaretArgs` maps empty to the
usage hint, exactly `doctor` and `demo` to those handlers, `plan <description>` and any
other text to planning. Exactly `plan` leaves planning while planning and shows the hint
otherwise. The planning, demo and doctor installers return their handlers; only
`pi/command.ts` registers the `/caret` command with pi.

## The planning mode: `/caret <description>`

**caret owns a small planning mode (`pi/plan.ts`), because pi has none.**

- The steer is a hidden message from `before_agent_start`. It tells the model to research
  only, write `<agentDir>/plans/<name>-<last 8 of session id>.md`, and call
  `caret_review_plan` with `path`. On a change request the model re-reads the file, edits
  it, and resubmits.
- The gate blocks `edit` and `write` outside the plans folder (`pi/gate.ts`). Path
  containment mirrors pi's resolver, resolves real paths, fails closed, and blocks
  `file://`.
- Planning ends when a review of a plan in the plans folder, submitted while planning, is
  approved, or when `/caret plan` runs with no description.
- The state is rebuilt from branch entries on `session_start` and `session_tree`, so a
  fork or a jump to before planning began is not planning. The steer is filtered out of
  context once planning ends.
- `/caret demo` sends `opencode/references/demo.md`, with `templates/demo.md` in place of
  its marker. It refuses to run while planning, because the planning steer would have the
  demo submitted from the plans folder, and approving it would end planning for the real
  task.

Non-goals:

- Shell commands are not gated; they stay prompt-guided, as in Plannotator.
- Entering planning mid-run gets the gate but no steer until the next prompt.

## The notice and the shortcut

**`pi/notice.ts` shows a pending-plan row above the editor and a `caret` footer status**,
`^ plan waiting` or `^ planning`. `ctrl+alt+o` opens the waiting plan through a detached
`caret band-link --session <id> --open`. In RPC mode the notice is one plain line with no
action, since an RPC client has no keybinding to name.

The shortcut is `ctrl+alt+o`, `o` for open. pi binds every `ctrl+letter`, and macOS window
managers such as Rectangle and Magnet take `ctrl+option+c` for "center window". pi binds
nothing on `ctrl+alt+o`. Terminal.app and iTerm2 pass it only with Option set to act as
Meta. The look is in [`design/decisions.md`](../../design/decisions.md) and
[`design/patterns.md`](../../design/patterns.md).

## Esc and a failed run

**`Esc` cancels; a failure never reads as a change request.**

- `Esc` aborts the tool. The signal kills `caret review` and the review expires. The
  outcome is `cancelled`, and the model is told the plan is not approved and to wait for
  the user. The row reads `cancelled`.
- A run fails on a caret-made fail-safe deny (`failsafe: true` on the wire), which
  includes caret not running at all (no `bun` on `PATH`, say). The outcome is `failed`,
  with `isError: true`, and the text tells the model to tell the user and not implement.
  The row reads `✕ review failed`.
- An unresolved `path` returns `resolvePlanSource`'s error, telling the model to write the
  file or pass `plan` inline, with `isError: true`. The store records the outcome as
  `failed`.

## `/caret doctor`

**`/caret doctor` runs `caret doctor` itself** rather than asking the agent to relay it.
It shows the report in pi's transcript as a custom entry that never reaches the model.

## The live check

**`test/pi/live.test.ts` runs real pi on Node against the packed package.** With
`test/support/pi-live.ts`, it installs the `npm pack`ed package into a throwaway agent dir
and drives pi with pi-ai's faux provider (`test/support/pi-faux-provider.ts`).
Requirements and placement are in [`test-layout.md`](test-layout.md). It covers:

- a deny's feedback reaching the model;
- planning's block-then-approve path;
- `/caret demo` opening a review;
- `/caret doctor` keeping its report out of the model's context;
- a hung daemon failing inside its bound.

To run it alone: `nice -n 10 mise run test --json --parallel=4 test/pi/live.test.ts`.

For pi's own behavior, read the installed pi's `docs/` and `examples/`. Run
`mise which pi`; they sit in `../node_modules/@earendil-works/pi-coding-agent/` relative
to the directory holding that binary. Docs under the old `@mariozechner` name are stale.

## Known gaps

- Not covered live: the approve-with-notes rows and `Esc` cancel.
- `ctrl+alt+o` is hand-checked only, with the key injected by `rex send-key`; no test
  drives a real terminal (EXC-2316).
- Extension filters in pi's settings aren't evaluated against globs
  (`src/adapters/pi/install.ts`).
- Print mode `pi -p "/caret …"` can exit before the follow-up runs (`pi/follow-up.ts`).
- There is no update reminder like OpenCode's toast.
