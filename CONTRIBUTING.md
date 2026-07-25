# Contributing to caret

*Audience: people who want to develop caret locally.*

caret is a tool-agnostic core plus an adapter for the coding agent it speaks to; it routes
that agent's plan to a human for review through a loopback daemon and a Svelte UI. This is
the short developer front door — `README.md` is the user-facing guide, `doc/ADVANCED.md`
is the deep reference, and `doc/agents/` holds the rules-of-the-road for working in a
given area.

## Setup

caret pins its toolchain with [mise](https://mise.jdx.dev) (bun, biome, hk, pkl). Install
mise, then bootstrap everything in one shot:

```sh
mise run setup   # pinned tools, bun install, the e2e Chromium, and git hooks
```

`bun install` on its own refreshes JS dependencies if that is all you need.

## Everyday tasks

```sh
mise run dev        # isolated daemon + a fake plan + the Vite UI on an ephemeral port
mise run preflight  # the pre-push gate: lint + unit/e2e tests + build, run concurrently
```

`mise run preflight` is the gate to pass before pushing. The full task catalog (`build`,
`test`, `smoke`, `lint`, `format`) is documented in
[`doc/ADVANCED.md`](doc/ADVANCED.md#development).

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
[`doc/ADVANCED.md`](doc/ADVANCED.md#configuration) — set values there, and never commit
secrets.

## Going deeper

- `README.md` — the user-facing front door: what caret is, install, and basic usage.
- `doc/ADVANCED.md` — the deep reference: build-from-source, architecture, the agent
  adapters, the full configuration surface, and the development workflow.
- `doc/agents/` — the rules-of-the-road for working in a given area of the code;
  `CLAUDE.md` routes you to the right one.
