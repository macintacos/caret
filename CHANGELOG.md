# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/macintacos/caret/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/macintacos/caret/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/macintacos/caret/compare/v0.0.5...v0.1.0
[0.0.5]: https://github.com/macintacos/caret/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/macintacos/caret/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/macintacos/caret/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/macintacos/caret/compare/v0.0.1...v0.0.2
