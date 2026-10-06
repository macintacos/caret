# Architecture Rules

caret is a tool-agnostic core plus one adapter axis: the coding agent it speaks to. The
boundary is the load-bearing structural invariant — keep it sharp and a second agent tool
slots in without touching core internals; blur it and agent vocabulary leaks everywhere.

## The two layers

- **`src/` is the tool-agnostic core, grouped by domain.** The core knows reviews, plans,
  and decisions; it does **not** know any agent's wire protocol. It is organized into
  cohesive domain directories (`daemon/`, `service/`, `review/`, `plan/`, `redact/`,
  `doctor/`, `ui/`, `config/`, `lib/`); [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §
  Layout describes what each one holds. `src/cli.ts` (the `bun build --compile`
  entrypoint) stays at the root, beside the gitignored generated UI manifest. There is
  deliberately no `src/core/` bucket — the domain directories **are** the core.
- **`src/adapters/<tool>/` implements one agent tool.** `src/adapters/adapter.ts` declares
  the `AgentAdapter` interface; `src/adapters/index.ts` is the registry that maps a tool
  id to its adapter and resolves the active one (by explicit id, then `CARET_AGENT`, then
  the default). `src/adapters/claude/` is the reference implementation and the default;
  `src/adapters/codex/` is a second (default-off, provisional) adapter that proves the
  seam. An adapter owns eight surfaces: `parseHookInput` (raw hook stdin → core
  `PlanInput`), `emitDecision` (core `Decision` → the tool's stdout wire shape),
  `fatalDenyLine` (a dependency-free last-resort deny line for the CLI's fatal handler),
  `approveVariants` (the post-approval options it offers), `readInstallState` (the doctor
  install probe), `listSkills` (the skill names the reviewer's `/` completion offers —
  names only, never a skill's contents), `readSkillDescription` (one named skill's own
  description, read on demand for the preview panel that completion opens — that
  description, never the rest of the skill's file), and `restartHint` (optional: the
  post-upgrade line What's new shows).

## The dependency law (grep-enforceable)

The dependency runs **one way**: an adapter imports core types; the core **never** imports
an adapter.

- **Composition is the only exception.** The wiring points — `src/cli.ts` and
  `src/commands/*` — select the active adapter and thread it in (e.g.
  `runReviewSubcommand` parses the hook stdin with the adapter's `parseHookInput` and
  hands `runReview` the result). Core modules like `review/orchestrate.ts` take the
  capability, or its output, as an injected dependency, so they name no adapter. A
  `from "./adapters/` import in a non-composition core module is the smell.
- **The emission seam lives at the composition layer, not the core.** `runReview` returns
  a tool-agnostic `Decision` (its fail-safe denies are `Decision`s the core constructs);
  the wiring point renders it to the agent's wire string with `adapter.emitDecision` at
  the moment it writes stdout. So the only `emitDecision` call sites are
  `src/commands/review.ts` (the normal path and the SIGINT/SIGTERM fail-safe) and
  `src/cli.ts`'s last-resort fatal handler — never the review core. The fatal handler
  keeps a hard-coded minimal deny string as a fallback for the one case the adapter itself
  failed to load, so the truly-fatal path still fails safe.
- **`ui/` never imports `src/adapters/*`.** Adapter capabilities reach the browser
  **over the wire**, not by import. The pattern: the daemon publishes the active adapter's
  `approveVariants` in `GET /api/health`, and the UI renders its approve split-button from
  that wire field (`ui/src/lib/approve.ts`), falling back to a built-in set when the field
  is absent. `listSkills` rides the same pattern one route over — the daemon serves the
  active adapter's skill names on `GET /api/reviews/:id/skills` and the feedback editors'
  `/` completion reads them from there (`ui/src/lib/skillCompletion.ts`), so an adapter
  that enumerates nothing simply leaves the list empty and no completion fires.
  `restartHint` rides `GET /api/health` too, but only from a spawned daemon: a resident
  one (the service, `caret serve`) withholds it, since its adapter is a default rather
  than the harness the user actually runs.

## Where agent vocabulary lives

Anything specific to a coding agent — hook payload field names, the decision JSON shape,
session mode/variant tokens like `acceptEdits`/`auto` — lives **only** in
`src/adapters/<tool>/`. The core carries opaque equivalents: `Decision.acceptMode` is an
`ApproveVariantId` (an opaque token the core transports without interpreting); only the
adapter maps a token to a tool permission (`setModeFor` in
`src/adapters/claude/approve.ts`).

`src/adapters/wire.ts` is the one shelf above the per-tool directories: the pieces every
PermissionRequest-hook adapter implements identically — the stdin parse, the neutral deny
text, and the `hookEventName` envelope — with each adapter's own decision payload passed
in as a parameter. Vocabulary shared by all of them belongs there; vocabulary one of them
owns still belongs only in its own directory.

**Adding a new agent tool:** create `src/adapters/<tool>/`, implement `AgentAdapter`
(declare its own approve variants with their ids/labels, parse its hook shape, render its
decision wire format and its `fatalDenyLine`, probe its install, enumerate its skills, and
optionally give its post-upgrade `restartHint`), add one `REGISTRY` entry in
`src/adapters/index.ts` keyed by the tool id, and add its `test/adapters/<tool>/` suite.
You touch `src/adapters/` and the registry — never core internals, store records, the
daemon's routing, or `test/core/`.

`src/adapters/codex/` is the worked second example: the OpenAI Codex CLI's
PermissionRequest hook is ~1:1 with Claude's (one JSON object on stdin, a
`hookSpecificOutput.decision.behavior = "allow" | "deny"` envelope plus an optional
`message` deny channel on stdout), so it reuses the same command-hook shape with its own
provisional wire details — registered, default-off, selectable via `CARET_AGENT=codex`,
and not yet live-verified (the live-contract check is a manual follow-up, the same pattern
as Claude's EXC-549). It adds **no** packaging: a registry entry plus its module and tests
are the whole change, which is exactly what the boundary is meant to make possible.

**OpenCode is the next candidate, and it is shaped differently.** OpenCode integrates as a
**JS plugin**, not a command hook: it exposes a `tool.execute.before` hook (throwing to
block a tool) and `permission.asked` events, loaded in-process — with a known subagent
bypass. So it does not fit the command-hook `AgentAdapter` shape the Claude and Codex
adapters share (stdin → parse → stdout deny line); it needs a different integration
surface. EXC-339 built that surface — a registered `caret_review_plan` tool that bridges
to `caret review` rather than a command hook; see
[`opencode-integration.md`](opencode-integration.md) for the spike and the design. Note it
as plugin-shaped before assuming a new tool slots into the command-hook mold.

**A registry entry may be composed from two adapters.** `claude-mcp`, set only by
`caret mcp` for plans submitted through Claude Code's `review_plan` tool, is Claude's
adapter with OpenCode's envelope parse and flat allow/deny swapped in, built inline in
`src/adapters/index.ts` rather than in an adapter directory, so no adapter imports
another.

**What does NOT move to the adapter directory:** the Claude plugin packaging —
`hooks/hooks.json`, `.claude-plugin/*` (including `plugin.json`'s `mcpServers` entry for
`caret mcp`), `commands/*.md` — sits where Claude Code's plugin system requires it on
disk. It is adapter-owned *surface* (Claude-contractual file locations), documented as
such, but not parameterized for hypothetical future tools. The Codex adapter likewise
ships no packaging today; Codex hook installation (`~/.codex/hooks.json` /
`config.toml [hooks]` behind `[features] codex_hooks`) is a documented future ship step,
not built here.

## Browser-safe shared modules

Some modules are imported by **both** runtimes — the compiled bun binary and the browser
UI bundle (the UI reaches them through the `@core/*` alias: `src/lib/types.ts`,
`config/constants.ts`, `redact/core.ts`, `ui/log-bridge.ts`, `lib/semver.ts`). Every such
module is **pure TS with zero node imports** — the node-free property is per-module, so a
browser-safe file can sit in a domain directory beside node-only siblings.

The reason is the browser bundle: a `node:*` import in a `@core`-shared module either
breaks the Vite build (node builtins have no browser equivalent) or drags the daemon's
node dependency chain into the browser. So the split is deliberate: the shared
algorithm/constants/types stay pure (e.g. `redact/core.ts` holds the `DENY_KEYS` walk),
and node-only concerns layer on top in a non-shared module (e.g. `redact/node.ts` adds the
home-path file scrub). Before importing a `src/` module from `ui/`, confirm it is
node-free — or extract the node-free part.

The UI is a standard multi-asset Vite build: `vite build` emits `ui/dist/index.html` plus
content-hashed `dist/assets/*` (JS + CSS), which the build embeds into the binary through
a generated manifest. `scripts/generate-ui-manifest.ts` enumerates `ui/dist/` into a
gitignored module of `with { type: "file" }` imports (`src/ui-manifest.generated.ts`) that
`bun build --compile` inlines, mapping each request URL path to its embedded file;
`src/ui/assets.ts` resolves that asset set and the daemon serves each asset by URL path
with per-path MIME and cache headers, plus a shared ETag (the asset-set digest) that lets
a matching `If-None-Match` get a bodiless 304. Dynamic `import()` in the browser bundle is
fine — the node-free invariant above is the only constraint a shared `@core` module owes.

## Daemon lifecycle

How long a daemon stays up, and who may replace it.
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) § The daemon's lifecycle is the narrative.

- **Residency is decided by what starts the daemon, not by a setting.**
  `CARET_SUPERVISED=1` (the service's unit, `mise run dev`) or `caret serve` makes it
  resident. `spawnDaemon` is the on-demand fallback, and it idle-exits.
- **The platform decision stays at composition.** `src/service/manager.ts` declares
  `ServiceManager`; `launchd-manager.ts` and `systemd-manager.ts` implement it over the
  pure unit-text builders `launchd.ts` and `systemd.ts`. `prodService()`
  (`src/commands/service-target.ts`) selects one. The core takes it injected:
  `prodEnsureDeps(s, service, …)` receives it as a thunk into `EnsureDeps.service`, so
  `src/daemon/` imports no platform manager.
- **A unit names the launcher, never a versioned caret path, and carries no
  version-dependent field.** `install()` is a no-op on a byte-identical unit, so
  `restart()` is the upgrade. Keep in sync: `isRunnableRoot` ↔ `root_runnable()` in
  `bin/caret-launcher`; `SERVICE_TERMINAL_EXIT_STATUS` ↔ its `exit 78`; `WORLD_VARS` ↔ the
  variables the launcher reads, which `test/structure/service-world-vars.test.ts`
  enforces. `launcherCandidateDirs` and `opencodeRootPaths` ↔ `candidate_dirs()`, whose
  OpenCode half both suites pin through the shared fixture
  `test/core/commands/install/fixtures/launcher-caches.txt`; `liveGenerationDir` ↔
  `live_generation()`; and `pickLauncherRoot` ↔
  `resolve_root()`/`candidates()`/`highest()`, including the rank that lets an agent's
  root win a version tie with an owned copy. `ownedRootsDir()` ↔ `owned_roots`.
- **A hook cycles the service rather than retiring its daemon**, which would only race the
  supervisor's restart. The gate is `/api/health`'s `supervised` plus the hook's state dir
  holding the service record (`launcherServiceFile()`); without the record there is no
  supervisor to cycle, and a supervised peer is retired like any other. `caret serve`
  refuses a supervised port instead. Never spawn into an empty port within
  `SUPERVISOR_WINDOW_MS` while the service `keepsAlive`.
- **SIGTERM drains; SIGINT stops at once.** SIGTERM is how a supervisor cycles the
  service, so `DRAIN_DEADLINE_MS` stays under its stop grace.
- **Only hand-run tasks exercise a real supervisor:** `mise run verify linux` and
  `mise run verify macos`. See [`test-layout.md`](test-layout.md) § Where else tests live.

## Daemon trust model

By default the daemon binds **loopback only** (`127.0.0.1`) and runs with **no auth**,
sized for a single-user laptop. On that default any local process can already reach the
daemon and read plan content, so the daemon does not authenticate local callers — the one
adversary it defends against is a **browser on another origin** that the user happens to
have open. `[daemon]` `host`, `hostnames` and `auth` (config-only, read at boot) widen the
bind and switch a token on; the rules below cover both shapes.

- **The auth switch.** `authEnabled` (`src/daemon/address.ts`): `daemon.auth` wins when
  set; unset, auth is on exactly when `isExposed(daemon.host)` — anything outside
  `127.0.0.0/8`, `::1` and `localhost`, so an unrecognized spelling errs toward auth on.
  `runDaemon` passes `tokenFile` to `createServer` only then; with no token file there is
  no gate.
- **An unusable `config.toml` fails closed.** A file that exists but does not parse or
  validate yields `FAIL_CLOSED_DEFAULTS` — the defaults with `daemon.auth = "token"` — not
  `DEFAULTS`, so a user who set `auth = "token"` behind a reverse proxy never silently
  loses it to one bad key. A daemon that already saw a good parse keeps it. An absent file
  is still plain `DEFAULTS`.
- **Token mechanics.** The daemon loads or mints the token file at boot; a file that
  exists but holds no readable token stops it with its own terminal error, not a bind
  failure. CLI clients send it as `Authorization: Bearer` (`daemonFetch`). A browser logs
  in once with `?token=`: `authGate` (`src/daemon/auth.ts`) checks it in constant time,
  sets a per-port cookie, and redirects with `token` stripped and every other parameter
  kept.
- **The token is printed only to a terminal the user ran:** by `caret serve` after
  `runDaemon` returns, and by `caret login-link`, which reads the token file without
  asking the daemon or minting one. Never by `caret daemon`, whose stdout and stderr land
  in `daemon-stderr.log`, which the `caret doctor` bundle ships unredacted; an integration
  test pins that.
- **Adapters reach the daemon only by spawning the caret CLI**, never over HTTP, so none
  bypasses the token. A new adapter that wants the daemon goes through `caret review` or
  another CLI command, which carries the token for it.
- **`POST /api/config` refuses `daemon.*`.** It writes `updates.check` and nothing else,
  so a logged-in device cannot turn auth off or rebind the daemon. A test pins it.
- **Refused requests don't touch liveness.** The Host, token and CSRF gates run before
  `liveness.begin`, so a network peer cannot keep an on-demand daemon alive with refused
  requests.
- **Read-confidentiality rests on the bind (plus the token, when on) + the absence of CORS
  headers, not on the CSRF guard.** The daemon emits **no** `Access-Control-*` header on
  any route, so the browser's same-origin policy blocks a foreign page from reading any
  response — even a `GET` that reaches a handler. A regression test
  (`test/core/daemon/server.test.ts`, the read-confidentiality block) asserts no route
  family ever emits an `Access-Control-*` header, so a future permissive-CORS "fix" fails
  loudly instead of silently exposing plan bodies. Never add a CORS-grant header.
- **The Host guard gates every method, safe ones included.**
  `isForeignHost(req, port, names)` (`src/daemon/guards.ts`) rejects a request whose
  `Host` is not one of the daemon's own names. That asymmetry with the CSRF guard is the
  point: under DNS rebinding the attacker's page *is* same-origin — loopback `Origin`,
  `Sec-Fetch-Site: same-origin` — so the SOP the read posture rests on is already defeated
  and only `Host` still names `evil.com`. A missing `Host` is rejected too.
- **The CSRF guard gates only non-safe methods.** `isCrossOrigin(req, port, names)`
  (`src/daemon/guards.ts`) rejects a state-changing request from a foreign Origin; safe
  methods (GET/HEAD, via `isSafeMethod`) are let through, because the SOP already protects
  reads and a foreign GET can't exfiltrate the response. The guard tests the verb through
  `isSafeMethod`, not a POST/PUT allowlist, so a future mutating verb (DELETE/PATCH) is
  CSRF-protected by default. A same-origin browser sends the daemon's own origin (allowed)
  and a hook/CLI sends no Origin (allowed); a foreign page's write is the only thing
  blocked. It holds with the token on too, since a browser carries the auth cookie on a
  cross-site write.
- **Two tiers of names** (`ownNames`). The **exact** tier — `127.0.0.1`, `localhost`,
  `VANITY_HOST`, and the connect hostname of the bind — needs the bound port too, so a
  page on some other `http://localhost:<port>` (a Vite dev server, a locally-hosted app, a
  dev server a malicious npm package started) is foreign rather than "loopback, therefore
  us". The Vite dev proxy therefore rewrites both `Host` and `Origin` to the daemon's own
  origin (`ui/vite.config.ts`) instead of the guard being widened to accommodate it. The
  **any-port** tier is `daemon.hostnames`: matched on any port, with an `http:` or
  `https:` Origin, because an HTTPS reverse proxy forwards its own Host (no caret port)
  and the browser's `https://` Origin — authority-exact matching would 403 everything
  through it. That divergence is scoped to names the user listed; a built-in name or any
  other loopback name (`[::1]`, `127.x`) never joins the any-port tier, even when listed,
  so listing `localhost` cannot make `http://localhost:3000` same-origin.
- **Residual: cross-port pages on a configured name.** A page served from another port of
  a `daemon.hostnames` name passes both guards. Modern browsers still stop its writes —
  they send `Sec-Fetch-Site: same-site`, which `isCrossOrigin` rejects — but an older
  browser that omits the header does not.
- **Residual: the token travels in cleartext.** The login link is `http://`, and the auth
  cookie is `httpOnly` but not `Secure`, so over plain HTTP the token and cookie are only
  as safe as the network path and the name's resolution: a passive listener on shared
  Wi-Fi, or any LAN peer answering an unauthenticated mDNS `.local` name, captures them
  and gets full API access. Off a trusted network, keep the bind on loopback behind an
  HTTPS reverse proxy.
- **No preflight handler exists or is needed.** A same-origin request sends no `OPTIONS`
  preflight, and a cross-origin preflight would be denied by the browser before any
  request body is sent (no advertised CORS headers).
- **Cross-uid local callers are a residual, not a closure** (EXC-1203). On the default
  loopback bind with auth off, any local uid can call the API; a same-uid process can
  already edit the plan files and `CLAUDE.md` directly, so authenticating local callers
  would buy nothing against the adversary caret runs beside. `daemon.auth = "token"`
  blocks cross-uid API calls, but not fully: the login link the review command opens on
  the server briefly sits on the `open`/`xdg-open` argv, readable through `ps`, and on
  Windows (`cmd /c start` splits the URL at `&`) the tab opens without it and shows the
  login page. Revisit if caret is ever sized for a multi-user host.

## Related rules

- `test-layout.md` — how `test/` mirrors this same core/adapter split.
- `logging-rules.md` — the redaction core (`redact-core.ts`) is one of these shared
  modules.
