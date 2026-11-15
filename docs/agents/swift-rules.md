# Swift Rules

*Audience: coding agents and contributors changing the macOS menubar app under
`menubar/`.*

`menubar/` is a SwiftPM package with no Xcode project: `mise run build menubar` assembles
its executable into `bin/caret-menubar.app` by hand. The app polls the daemon and swaps
the menu-bar icon. These are the conventions it follows.

## The package

- **Swift 6 mode, tools 6.2.** `Package.swift` declares `swift-tools-version: 6.2`, which
  turns on Swift 6 language mode with complete concurrency checking. It needs Xcode 26 or
  later. CI pins Xcode 26.6 through `DEVELOPER_DIR` in both `menubar.yml` and
  `publish.yml`, and `test/scripts/release-workflow.test.ts` keeps the two equal.
- **macOS 13 floor.** `platforms: [.macOS(.v13)]` matches `Info.plist`'s
  `LSMinimumSystemVersion`. Put any API newer than macOS 13 behind
  `if #available(macOS NN, *)` with a macOS 13 path. The `menubar` workflow fails when
  either slice of the built binary records a `minos` other than `13.0`.
- **Logic in Core.** `CaretMenubarCore` holds every decision that needs neither AppKit nor
  I/O: launch-argument parsing, the poll request, and what a response means. The
  `CaretMenubar` executable is the AppKit shell around it. New logic goes in Core, where
  the tests reach it.
- **Main actor in the app only.** The executable target sets
  `.defaultIsolation(MainActor.self)`, so its AppKit types need no `@MainActor`. Core
  keeps the `nonisolated` default.
- **`package`, never `public`.** Only this package's executable and tests import Core.
- **No resources.** SwiftPM's `Bundle.module` looks for its resource bundle at the `.app`
  root, and a hand-built bundle can't put one there without failing
  `codesign --verify --strict`. Draw images at runtime, as the carrot is drawn.

## Logging

The app logs through `os.Logger` under the subsystem `dev.excessive.caret.menubar`, never
`print`. Log a state change, not every poll. Stderr carries only the bad-arguments message
and runtime traps; the LaunchAgent sends it to `menubar-stderr.log` in caret's logs
directory.

## The contract with TypeScript

`menubar/Tests/CaretMenubarCoreTests/contract.json` holds the facts both languages must
agree on: the default URLs, the launch flags, which hosts count as loopback, and the
`GET /api/pending` body. `ContractTests.swift` and
`test/core/daemon/menubar-contract.test.ts` both read it. Change a shared fact in the
fixture and on both sides in the same change. The fixture is listed under `exclude:` in
`Package.swift`, and the Swift tests find it through `#filePath`, so the test target
declares no resources.

## Tests

- **Swift Testing only:** `import Testing`, `@Test("a sentence")`, `#expect`, and
  `arguments:` for a table of cases. `mise run test swift --json` counts Swift Testing's
  report alone, so an XCTest case would run without being counted.
- **Core only.** The suites in `menubar/Tests/CaretMenubarCoreTests/` cover Core. The
  executable has no tests, which is one more reason to keep it thin.
- **Run them with `mise run test swift`.** It passes `-Xswiftc -warnings-as-errors`.
  `Package.swift` does not, so a newer toolchain's new warnings never break a plain
  `swift build`. Off macOS, or without `swift` on PATH, it prints why and exits `0`.

## Format and lint

`swift format` ships in the toolchain and reads `menubar/.swift-format`: 4-space indents
and 100 columns. The hk step `Swift(Format)` runs `swift format --in-place` on commit and
in `mise run format`, and `swift format lint --strict` in `mise run lint`. `--strict`
turns its lint rules' warnings into failures, which is why there is no SwiftLint. The step
skips on a machine without `swift`.

Different toolchains can format differently. The required `lint` check runs this step on
GitHub's Ubuntu image, whose Swift is unpinned, and the `menubar` workflow lints again
under the pinned Xcode. If the two ever disagree, make the hk step macOS-only rather than
satisfy both.

## The gates

- **`mise run preflight`** runs `test swift` and `build menubar` as lanes of their own.
  Off macOS, or without `swift`, it reports both `skipped`, with the reason.
- **The `menubar` workflow** builds the app, checks the bundle, and runs
  `mise run test swift` and `swift format lint --strict --recursive menubar` on macOS. It
  runs only when a PR touches `menubar/`, `scripts/tasks/build.ts` or
  `scripts/tasks/test.ts`, their `.mise/tasks/` forwarders, or the workflow itself.
