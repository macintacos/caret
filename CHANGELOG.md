# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.2] - 2026-06-02 - The Foundations Release

### Added

- caret: a local web UI for reviewing and approving Claude Code plans (#1).
- Safe Mode, which ignores accidental in-flight keystrokes so plans aren't
  approved or rejected by stray input (#3).
- Persistent exception logs plus a `/caret:debug` command for inspecting the
  most recent failure (#2).
- Syntax highlighting for code blocks inside plans, powered by shiki (#9).
- A one-command release flow: a deterministic release script paired with the
  `/release-caret` skill (#10).
- Markdown, YAML, TOML, shell, and pkl formatters and linters wired into
  mise + hk (#4).
- A seeded fake plan for `mise run dev` so the UI has content during local
  development (#7).

### Changed

- The UI now uses the platform sans-serif font, reserving serif for the caret
  wordmark (#5).
- A plan's first heading always renders as an H1, regardless of the level it
  was authored at (#6).
- The installer pulls caret from the latest release tag rather than the default
  branch (#12).
- Preflight now runs its mise tasks directly (#11).
- The README heading sports a carrot emoji (#8).

### Fixed

- Review decisions are delivered via a bounded poll, fixing missed or delayed
  decision delivery.

[Unreleased]: https://github.com/macintacos/caret/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/macintacos/caret/compare/v0.0.1...v0.0.2
