# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.1] - 2026-07-21 - The Affordances Release

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

## [0.7.0] - 2026-07-20 - The Keyboard-First Release

### Added

- **Keyboard-driven review.** The review surface became operable from the keyboard end to
  end. A shortcut registry and global dispatcher landed as the foundation (#263), then a
  focused-line cursor with vim-style motion over the plan (#266), keyboard shortcuts for
  the review actions and chrome (#267), commenting on the focused line without reaching
  for the mouse (#268), and keyboard navigation through the comment viewer (#270).
- **Shortcuts help modal and status bar.** A help modal lists every shortcut and a bottom
  status bar surfaces the ones in reach (#264). `cmd+enter` confirms the approve/reject
  dialog (e24567c), and `\` toggles the sidebar (#271).
- **Vim-style `/` search over the plan.** Press `/` to search the plan text and jump
  between matches, the way you would in vim (#274).
- **Toggle for shortcut hints.** A settings toggle shows or hides the inline shortcut
  hints (#269), and the compare toggle now advertises its `d` shortcut (f65a322).

### Changed

- **Redesigned shortcuts help modal.** The help modal was reworked wider and multi-column,
  with `/`-to-search across the shortcut list (#276).
- **Keycaps flattened toward GitHub's look.** The `Kbd` keycaps were flattened toward
  GitHub's style (82a10e9), letter caps now render as capitals (#272), and `Shift` renders
  as an icon (e39a071).
- **Softer review chrome.** The focus ring was softened to a subtle accent (8986fc9), the
  approve split-button seam tightened (393c944), and the review confirm-dialog widths were
  widened and unified (#265).
- **Styled links and a marked dev tab.** Links got a light styling pass (fa813f1), and the
  dev tab is now marked with a carrot favicon (ab042be).
- **Developer tooling.** `app.css` was split into `styles/` partials (fc6edfa), long
  shadcn class strings were grouped into commented, concern-grouped chunks (#273), and
  missing component purpose headers plus a `longPoll` null-return doc were filled in
  (decb393).

### Fixed

- **Esc resets the plan line cursor.** Pressing Esc now clears the focused-line cursor in
  the plan, which it previously left stranded (#275).

## [0.6.0] - 2026-07-18 - The Fits Anywhere Release

### Added

- **Collapsible table-of-contents rail.** The plan's table of contents became a
  collapsible rail that folds away at narrow widths, reclaiming reading room when the
  review surface is docked in a slim column (#256).
- **Icon on the Compare versions button.** The Compare versions button now carries an icon
  (#255).

### Changed

- **Responsive review UI at narrow widths.** The review surface was reworked to stay
  usable at narrow widths, so caret fits docked in a slim column beside your editor. A
  narrow-width audit and the width foundation landed first (#253), then each region was
  reshaped in turn: the working-directory path moved onto the compare row (#254), the
  TopBar controls consolidated (#257), the version-compare bar and diff layout went
  responsive (#258), the pinned chrome now stacks (#259), and dialogs and overlays fit to
  narrow widths (#260) — closed out by a cohesion pass and an end-to-end regression
  guarding the narrow-width behavior (#261).
- **Adjusted demo plan.** The `/caret:demo` plan's contents were tweaked (0dec29b).
- **Developer tooling.** `mise run format` gained a Tailwind canonical-class step
  (a16e3f8), and a `ui/package.json` stub lets shadcn-svelte's CLI run (1d0fa2c).

## [0.5.0] - 2026-07-16 - The Welcome Mat Release

### Added

- **First-run onboarding and notification bell states.** A new reviewer is greeted by a
  first-run onboarding dialog, and the notification bell now carries explicit states —
  idle versus a dot that draws attention when a plan is waiting. Local dev gained a
  `--fresh` boot that isolates its config so onboarding and preferences can be exercised
  from a clean slate (#246).
- **Confirm before approving.** Approving a plan now asks for confirmation first through a
  modal, so a stray click can't ship an approval you didn't mean (#247).
- **Scroll past the end of the plan.** The plan view now lets you scroll beyond the last
  line, so the bottom of a plan no longer sits pinned against the window edge while you
  read or comment (#245).

### Changed

- **Notifications clear when you open their plan.** Opening a plan now dismisses its
  lingering desktop notification, so the bell and your notification tray stay in sync with
  what you've actually looked at (#251).
- **Steadier file-preview hover.** The filename-reference hover preview gained a
  trajectory grace period, so the preview no longer flickers away when your pointer
  briefly clips its edge on the way in (#244).
- **Refined inline comment card.** Inline comment cards now render their prose in
  sans-serif, focus the edit caret when you start editing, and keep their actions
  collapsed until you need them (#250).
- **Warmer light theme.** The caret light theme's neutral greys were warmed for a softer,
  less clinical reading surface (#249).
- **Installer shows the version.** `install.sh` now prints the caret version at the start
  and finish of a run (7e40db1).
- **src/ reorganized into domain directories.** The flat `src/` tree was reorganized into
  domain directories, with the layout docs rewritten to describe each directory by purpose
  rather than by file list (#242, #243).
- **Adopted the `@/` import alias.** The codebase moved onto the `@/` import alias and
  turned on Biome's import organization (#248).
- **Looser tool pins.** The mise tool pins were loosened and the lockfile refreshed
  (#241).
- **README hero screenshot.** The README now leads with a review-UI hero screenshot
  (#240).
- **Reflowed release notes.** GitHub Release notes are reflowed to single-line paragraphs
  and prefaced with a short summary, and the release code was relocated alongside the rest
  of the tasks CLI (#239).

## [0.4.1] - 2026-07-15 - The Fresh Resolution Release

### Fixed

- **OpenCode install resolves the latest caret every time.**
  `caret install --target opencode`, and the manual install commands documented in the
  README, now run `bunx` with `--no-cache` — forcing a fresh `@latest` resolution so a
  stale bunx cache can no longer pin the install to an older published version.

## [0.4.0] - 2026-07-15 - The Plugin Path Release

### Added

- **OpenCode plugin-array install.** caret now installs into OpenCode as a first-class npm
  plugin: a bare `plugin: ["@macintacos/caret"]` entry in the OpenCode config, with
  `caret install --target opencode` editing that array (comment-preserving) while OpenCode
  fetches the published package itself. The plugin resolves its own binary and version at
  runtime, so it works when loaded straight from npm (#236).
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

## [0.3.0] - 2026-07-14 - The Reforged Release

### Added

- **Color palettes and theme switching.** The review UI now supports selectable color
  palettes and switching between themes, with the diff view's syntax colors following the
  active theme (#218).
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
  migration superseded (#220, #221, #222, #223, #226, #228, #230, #231, #232, #233, #234).
- **Consolidated preference storage.** The duplicated localStorage enum-preference modules
  were collapsed into a single shared helper (#217).
- **Bug reports point at the discovery command.** The README's bug-reporting section now
  directs you to the `/caret:discovery` slash command for a diagnostics snapshot (#227).

### Fixed

- **Comment composer caret jump.** The inline comment composer no longer jumps the caret
  to the wrong position when you switch the line it's anchored to (#229).

## [0.2.0] - 2026-07-12 - The Reviewer Release

### Added

- **Reject decision.** A Reject button in the review top bar rounds out the decision set
  alongside Approve and Request Changes (#214).
- **Persistent inline comment scratches.** Uncommitted inline-comment scratches now
  persist across reloads, scoped to the plan version, so in-progress annotations survive a
  refresh or a new plan version (#209).
- **Discard affordance for the inline composer.** The inline comment composer gained an
  explicit control to discard a draft (#212).
- **Filename-reference hovering.** Filename references in the plan view are now
  intelligently hoverable (#201).
- **Agent-interface plan reconciliation.** Plan decisions made directly in the agent's own
  interface are reconciled back into caret's review state (#195).

### Changed

- **Unified tasks CLI.** The remaining mise file tasks were consolidated into a single
  tasks CLI: build/test/smoke collapsed into single tasks, the release CLI merged in, raw
  args passed through the mise file tasks, and the preflight gate moved into the CLI —
  plus dev-task follow-ups (in-process driver, testable supervision, flags) (#203, #204,
  #206, #207, #208, #213).
- **Release prepare no longer preflights.** The preflight gate was removed from the
  release prepare step (a758a5e).
- **Unsent-comment guardrails.** The approve "are you sure?" guard now previews the unsent
  comments it is about to drop and counts unsent inline scratches toward the pending total
  (#210, #215).
- **Distinct, scrollable plan code blocks.** Code blocks get a distinct panel styling in
  the plan view and scroll horizontally when wide (#198, #200).
- **Leaner OpenCode change-request output.** OpenCode change-request tool results no
  longer re-paste the full plan (#196).
- **Documented the review timeout.** Added an explanation of why the caret review timeout
  exists (#194).

### Fixed

- **Visible Save/Discard in Request Changes.** Unsent-scratch Save/Discard controls stayed
  hidden inside a collapsed disclosure in Request Changes; they are now always visible
  (#211).
- **Deduped plan-review notifications.** Desktop plan-review notifications no longer fire
  once per open tab (#202).
- **Cleared lingering OpenCode review link.** The OpenCode review-link line is now cleared
  after a plan decision (#197).

## [0.1.3] - 2026-07-07 - The Compatibility Release

### Fixed

- **Plan approval on Claude Code 2.1.199+.** Newer Claude Code (≥2.1.199) silently
  discarded caret's plan-approval decision unless it echoed the plan tool's input back, so
  clicking Approve did nothing while Request Changes still worked. caret now returns the
  plan's tool input alongside its allow decision, restoring the Approve action on current
  Claude Code (#192).

## [0.1.2] - 2026-06-23 - The Single Gate Release

### Changed

- **Single-gate release flow.** The `/release-caret` skill now asks for exactly one
  confirmation — the script-computed version — and accepting it authorizes the entire run
  end-to-end: opening the release PR, merging it, tagging trunk, and publishing the GitHub
  Release and npm. The previous separate remote-mutation prompt is gone (#190).

## [0.1.1] - 2026-06-23 - The Tidying Release

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

- **OpenCode plugin deployment.** caret now deploys its OpenCode plugin into the canonical
  plural `plugins/` directory instead of the backwards-compatibility `plugin/` alias
  (#185).
- **OpenCode command deployment.** caret now deploys its OpenCode commands into the
  canonical plural `commands/` directory instead of the backwards-compatibility `command/`
  alias (#187).

## [0.1.0] - 2026-06-18 - The Plan Review Release

### Added

- **Rebuilt plan-review surface.** Plans now render through a new source view built on
  `@pierre/diffs`, with caret's theme, fonts, and color palette bridged into the diff view
  (#119, #122, #125).
- **Inline annotations.** Line-anchored comments, created from the line gutter or by
  dragging across the code body, appear as scroll-synced inline cards framed as ordered
  per-line threads, with a host-side bracket spanning each comment's line range (#121,
  #126, #129, #146, #147, #150, #172).
- **Markdown comment composer** with live styling, auto-grow, and rendered comments
  (#174).
- **Version compare.** A version picker, side-by-side diff, layout toggle, sticky compare
  header with caret-tied counts, and classic `+`/`-` diff indicators (#128, #153, #155).
- **Filterable table of contents** for the source view, with per-level indent guides and
  per-heading deep-linking by header slug (#127, #160, #161).
- **Clickable links** in the source view, with a caret-themed link-hover tooltip (#123,
  #162).
- **Returnable comment drafts.** An unsaved comment draft is kept as a Resume marker, and
  unsaved scratches surface in Request Changes with Save or Discard (#169, #170).
- **Pending-comment guardrails.** The pending-comment count is surfaced before submit, and
  approve is guarded while inline comments are still pending (#148, #149).
- **Reader affordances** — line-wrap and hide-line-numbers toggles (#152).
- **Persistent plan-review status strip** pinned as a fixed root sibling (#165).
- **OpenCode support.** caret now drives OpenCode through its adapter registry, alongside
  Claude Code and Codex (#179).
- **GitHub-based plugin installation.** The plugin now publishes to npm so
  `/plugin marketplace add macintacos/caret` resolves the latest version (#178).
- **Feedback cites line numbers** with quoted lines in submitted reviews (#124).
- A `run-caret` skill that launches local dev and opens the review UI (#167).
- Plans are formatted with prettier at version ingest (#118).

### Changed

- **Design-token system.** Motion tokens with a global reduced-motion rule, a named
  numeric type scale with tabular figures, and the diff surface's add/delete colors and
  layered styling tied to caret's palette (#140, #141, #142, #143, #144, #145, #156, #157,
  #158, #159).
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
  plan-file sync, inline comments, and table-of-contents scroll accuracy (#134, #135,
  #136).
- The off-by-one table-of-contents active-heading highlight is corrected (#175).
- An orphaned decision-registry entry is cleared on a revision resubmit (#139).

## [0.0.5] - 2026-06-12 - The Build Awareness Release

### Added

- **Build version badge.** The running build's version now shows in a bottom-left UI
  badge, so you can tell at a glance which build you're reviewing against (#109).
- **Machine-readable preflight.** `mise run preflight` accepts a `--json` flag that emits
  compact `start` and `result` documents for tooling and agents instead of the live human
  display (#113).

### Changed

- **Build-gated dev settings.** Development-only settings are consolidated into a single
  `[dev]` config section gated to non-release builds, so dev-only behavior can't leak into
  a released build (#115).
- **Gated dev seeder.** The `mise run dev` extra-review seeder is now off by default,
  fired only behind an explicit `--notify` flag (#106).
- The end-to-end test suite moved into `test/e2e` (#112).

### Fixed

- **Notifications on the installed build.** New-plan desktop notifications now fire on the
  installed build, not just during local development (#110).
- **Reliable tab presence.** UI tab-presence detection is now robust to browser background
  throttling, so presence isn't lost when the tab is backgrounded (#114).
- Markdown links are stripped from the titlebar post title, so it renders as clean text
  (#111).

## [0.0.4] - 2026-06-09 - The Adapter Release

### Added

- **Codex support.** caret now drives OpenAI Codex alongside Claude Code, selected through
  a pluggable adapter registry — the core/adapter seam proven with a real second agent
  (#58, #71, #87, #89).
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
- **UI overhaul.** All iconography is now vendored Lucide SVGs, the typeface stack prefers
  Inter Display, monospace is reserved for code and intentional accents, and the plan
  table-of-contents was redesigned as a hover-expanding tick rail (#24, #29, #36, #42,
  #43).
- **Faster, leaner UI build.** Shiki grammars load as lazy dynamic-import chunks, and the
  UI is embedded as a multi-asset build via a generated manifest (#82, #83).
- Agent rules are now routed through a checked-in `CLAUDE.md` (#107).
- Local dev builds are flagged in the UI so they're distinguishable from released builds
  (#103).
- Preflight runs in parallel behind a live task display (#46).

### Fixed

- Stale pending reviews now expire on hook timeout and resubmit, instead of hanging (#37).
- `install.sh` build drift and duplicated UI-fallback copy are corrected (#52).

### Security

- Plan HTML is sanitized last with an explicit DOMPurify allowlist, hardened by an
  adversarial XSS test suite (#90, #92).
- A safe-method CSRF guard and a no-CORS posture protect the daemon's HTTP surface (#95).
- State directories are created `0700` and plan JSON `0600`, unified through
  `ensureStateDir` (#94).

## [0.0.3] - 2026-06-02 - The Hardening Release

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

## [0.0.2] - 2026-06-02 - The Foundations Release

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
- A plan's first heading always renders as an H1, regardless of the level it was authored
  at (#6).
- The installer pulls caret from the latest release tag rather than the default branch
  (#12).
- Preflight now runs its mise tasks directly (#11).
- The README heading sports a carrot emoji (#8).

### Fixed

- Review decisions are delivered via a bounded poll, fixing missed or delayed decision
  delivery.

[Unreleased]: https://github.com/macintacos/caret/compare/v0.7.1...HEAD
[0.7.1]: https://github.com/macintacos/caret/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/macintacos/caret/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/macintacos/caret/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/macintacos/caret/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/macintacos/caret/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/macintacos/caret/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/macintacos/caret/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/macintacos/caret/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/macintacos/caret/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/macintacos/caret/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/macintacos/caret/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/macintacos/caret/compare/v0.0.5...v0.1.0
[0.0.5]: https://github.com/macintacos/caret/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/macintacos/caret/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/macintacos/caret/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/macintacos/caret/compare/v0.0.1...v0.0.2
