# Contributing to caret

*Audience: people who want to develop caret locally.*

caret is a tool-agnostic core plus an adapter for the coding agent it speaks to; it routes
that agent's plan to a human for review through a loopback daemon and a Svelte UI. This is
the short developer front door — `README.md` is the user-facing guide, `doc/` holds the
deep reference (configuring, running, architecture, development), and `doc/agents/` holds
the rules-of-the-road for working in a given area.

## Setup

caret pins its toolchain with [mise](https://mise.jdx.dev) (bun, biome, hk, pkl), and mise
is the only prerequisite. Every task bootstraps the clone if it needs to, so a fresh
checkout can go straight to the task you actually want — `mise run dev` or
`mise run lint`, with no setup step first.

Whichever task you run first installs the pinned tools, JS deps, and generated palette
before doing its own job, and registers the git hooks along the way. mise asks you to
trust the clone's config the first time — answer yes, or run `mise trust` up front.

`mise run setup` runs those same steps and adds the e2e Chromium the bootstrap leaves out;
run it before the e2e suite — `mise run test e2e`, and `mise run preflight`, which
includes it.

`bun install` on its own refreshes JS dependencies if that is all you need.

## Everyday tasks

```sh
mise run dev        # dev console: isolated daemon + three fake plans + the Vite UI
mise run preflight  # the pre-push gate: lint + unit/e2e tests + build + artifact smoke
```

`mise run preflight` is the gate to pass before pushing. It scopes itself to your diff, so
a Markdown-only change runs fewer than the full six tasks — `--full` forces all of them.
The full task catalog (`build`, `test`, `smoke`, `lint`, `format`) is documented in
[`doc/DEVELOPMENT.md`](doc/DEVELOPMENT.md#development).

## Where tests live

- `test/` — backend suites: `core/` (tool-agnostic, carrying the same domain directories
  `src/` uses), `adapters/<tool>/` (per-agent), plus `opencode/`, `scripts/`,
  `structure/`, and `support/`. A suite's path mirrors its module's, so `src/x/y.ts` is
  covered by `test/core/x/y.test.ts`; the full rule is in `doc/agents/test-layout.md`.
- `ui/src/**/*.test.ts` — Svelte component and UI-logic tests, run with
  `bun test --conditions browser` from the repo root.
- `test/e2e/` — Playwright browser end-to-end specs (`mise run test e2e`). When to write
  an e2e spec versus a unit test is covered in `doc/agents/browser-testing.md`.

## Configuration

caret reads a `config.toml` and `CARET_*` environment variables (for example `CARET_PORT`
and `CARET_AGENT`). The full list of keys, their defaults, and what each one does lives in
[`doc/CONFIGURING.md`](doc/CONFIGURING.md) — set values there, and never commit secrets.

## Going deeper

- `README.md` — the user-facing front door: what caret is, install, and basic usage.
- `doc/CONFIGURING.md` — platform support, the config file, the `CARET_*` environment
  variables, and plan formatting.
- `doc/RUNNING.md` — desktop notifications, cmux unread marks, and logging & debugging.
- `doc/ARCHITECTURE.md` — the core/adapter boundary, the agent adapters, the review tool,
  and the source layout.
- `doc/DEVELOPMENT.md` — build from source, the dev workflow, the tasks CLI, and icons.
- `doc/agents/` — the rules-of-the-road for working in a given area of the code;
  `CLAUDE.md` routes you to the right one.
