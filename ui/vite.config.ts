import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

import { DEFAULT_PORT } from "../src/config/constants.ts";
import { budgetFailure, measureDist, UI_BUNDLE_BUDGET_BYTES } from "./bundle-budget.ts";

// The dev daemon the `/api` proxy below forwards to. Hoisted so the target and
// the Origin the proxy rewrites to cannot drift apart.
const DEV_API_TARGET = `http://localhost:${process.env.CARET_PORT ?? DEFAULT_PORT}`;

// Where caret-bundle-budget measures, captured from the resolved config rather
// than read off writeBundle's options so the directory never depends on cwd.
let outDir = "";

// A standard multi-asset build: Vite emits dist/index.html plus content-hashed
// dist/assets/* (JS + CSS). The binary embeds each asset by URL path via a
// build-generated manifest, and the daemon serves them with per-path MIME and
// cache headers (EXC-522).
export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte(),
    {
      // The caret-dark first-paint fallback (src/styles/palette.generated.css) is
      // emitted from THEMES["caret-dark"] and gitignored, so it must exist before
      // app.css's @import is resolved — for `vite build` and the dev server alike.
      // Spawned rather than imported: vite bundles this config with esbuild before
      // evaluating it, and whether that loader honours the UI program's $lib alias
      // transitively is not something to bet the build on.
      name: "caret-palette-css",
      config() {
        const { status } = spawnSync("bun", ["generate-palette-css.ts"], {
          cwd: fileURLToPath(new URL(".", import.meta.url)),
          stdio: "inherit",
        });
        if (status !== 0) throw new Error("caret: generate-palette-css.ts failed");
      },
    },
    {
      // EXC-426: print the vanity origin in the dev banner. Cosmetic — the bind
      // stays localhost (binding caret.localhost needs the OS resolver; browsers
      // resolve *.localhost themselves). Vite serves *.localhost Hosts by
      // default, and the daemon's same-origin guard allows caret.localhost, so
      // the printed link works end-to-end in dev too.
      name: "caret-vanity-url",
      configureServer(server) {
        const printUrls = server.printUrls.bind(server);
        server.printUrls = () => {
          if (server.resolvedUrls) {
            server.resolvedUrls.local = server.resolvedUrls.local.map((u) =>
              u.replace("//localhost", "//caret.localhost"),
            );
          }
          printUrls();
        };
      },
    },
    {
      // EXC-1217: assert the built dist/ against the budget in ui/bundle-budget.ts.
      // The three shiki entries in the resolve.alias block below are what hold that
      // number down; before this plugin an alias that stopped matching grew the
      // bundle and failed nothing. Throwing from writeBundle fails `vite build` with
      // a non-zero exit — the same thing caret-palette-css does with its own throw —
      // so `build ui`, `build bin`, `build bundle`, `test e2e`, and preflight's own
      // `build ui` task all inherit the gate with no further wiring.
      name: "caret-bundle-budget",
      apply: "build",
      configResolved(config) {
        outDir = resolve(config.root, config.build.outDir);
      },
      writeBundle() {
        const failure = budgetFailure(measureDist(outDir), UI_BUNDLE_BUDGET_BYTES);
        if (failure) throw new Error(failure);
      },
    },
  ],
  resolve: {
    // CodeMirror's extension system is identity-sensitive: a Facet, StateField, or
    // Language carries the identity of the module instance that created it, and
    // `EditorState.create` rejects anything it does not recognise as its own with
    // "Unrecognized extension value in extension set". So a SECOND physical copy of
    // any of these anywhere in the install tree breaks MarkdownEditor.svelte — the
    // editor never constructs, the $effect throws, and the surface renders as an
    // empty bordered box (a reviewer sees the Notes label with no field under it).
    //
    // This is a property of the resolved node_modules tree, not of bun.lock, which
    // is why a clean lockfile is no defence: bun does not reliably prune a stale
    // nested copy left by an older install, and the duplicate then reaches both the
    // dev server and `vite build`. Deduping resolves every importer to the one copy
    // at the root regardless of how the tree is shaped. @lezer/common rides along
    // because Tree/NodeType identity flows through the same extensions.
    //
    // `bun dedupe` / `bun prune` (new in 1.4) do not replace this. Both act on
    // bun.lock, and what breaks the editor is the resolved tree, so a clean lock is no
    // substitute for an always-on resolution rule — even now that dedupe is gated by
    // `bun test` (test/structure/dependency-dedupe.test.ts). Measured in
    // test/structure/codemirror-single-copy.test.ts's header.
    dedupe: ["@codemirror/state", "@codemirror/view", "@codemirror/language", "@lezer/common"],
    // `@core/*` resolves to the tool-agnostic core in src/, so the UI imports
    // the wire contract (src/lib/types.ts) directly. Type-only imports erase at
    // build, keeping the browser bundle free of node-only code; the matching
    // tsconfig `paths` mappings keep svelte-check and bun test in step (EXC-507).
    //
    // The bare `shiki` specifier (imported by @pierre/diffs) resolves to the
    // bundle shim, not shiki's own bundle entry. The shim swaps the highlighter's
    // engine (caret uses shiki's pure-JS regex engine, not the Oniguruma WASM
    // binary) and themes (caret registers its own), and — per EXC-665 — exposes
    // shiki's FULL language bundle so every grammar an agent can tag a fenced code
    // block with highlights, not just a hand-picked subset. The grammars are lazy
    // `() => import(...)` loaders, so vite code-splits one on-demand chunk per
    // grammar; caret runs entirely locally, so the embedded asset's size is a
    // non-concern. The `/^shiki$/` regex anchors an exact match so deep specifiers
    // (shiki/core, shiki/langs/*, shiki/engine/*, shiki/bundle/full) keep
    // resolving to the real package — only the bare barrel is redirected.
    alias: [
      // `@/*` → ui/src/*, the app-code alias UI modules import their own siblings
      // through. The regexp anchors on the `@/` boundary so it matches `@/x` only
      // — never `@core/x` or a scoped package like `@scope/pkg` — and so is
      // order-independent against the entries below. Mirrors the ui/tsconfig
      // `@/*` mapping so svelte-check, the vite build, and bun test agree.
      { find: /^@\//, replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/` },
      { find: "@core", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
      // `$lib` → ui/src/lib, the import prefix shadcn-svelte's copied components
      // and components.json assume. Mirrors the @core mapping; the matching
      // tsconfig `paths` entry keeps svelte-check and bun test in step (EXC-757).
      { find: "$lib", replacement: fileURLToPath(new URL("./src/lib", import.meta.url)) },
      {
        find: /^shiki$/,
        replacement: fileURLToPath(new URL("./src/lib/diffview/shiki-bundle.ts", import.meta.url)),
      },
      // shiki/wasm (the Oniguruma engine) and the ten @pierre/theme/* palettes are
      // both reachable only through lazy `import(...)` the library never takes:
      // caret runs the JS regex engine, and it registers its own themes, so the
      // theme collection @pierre/theming assembles is never consulted for a name
      // caret can name. Aliasing both to a throwing stub keeps ~600 KB of WASM and
      // the pierre theme payloads out of the build.
      //
      // @shikijs/themes/* is the other half of that same collection and looks like
      // it belongs here, but stubbing it breaks the app — this cost a release-blocking
      // regression to learn, so it is written down. The collection is not the only
      // route to those modules: upstream-shiki.ts imports seven of them ITSELF, as
      // `shiki/themes/<name>.mjs`, and in shiki 4.x each of those files is a one-line
      // re-export of `@shikijs/themes/<name>`. The alias therefore does not stub a
      // payload the library declines to load — it replaces caret's own vendor palette
      // data (EXC-896: dracula, github-*, catppuccin-*) with a throwing function, and
      // every vendor palette a reviewer picks renders unthemed. settings.e2e.ts is
      // what catches it. Nothing caret ships is named pierre-*, which is the whole
      // reason the entry below is safe where this one is not.
      {
        find: /^shiki\/wasm$/,
        replacement: fileURLToPath(
          new URL("./src/lib/diffview/unused-shiki-extras.ts", import.meta.url),
        ),
      },
      {
        find: /^@pierre\/theme\/.*/,
        replacement: fileURLToPath(
          new URL("./src/lib/diffview/unused-shiki-extras.ts", import.meta.url),
        ),
      },
    ],
  },
  server: {
    // `mise run dev` proxies the JSON API to its isolated dev daemon. The dev
    // task discovers the daemon's ephemeral port from its lock file and exports
    // it as CARET_PORT before Vite starts (EXC-461), so the daemon and this
    // proxy can't diverge; the prod default keeps `vite build` working.
    proxy: {
      "/api": {
        target: DEV_API_TARGET,
        // The daemon gates on an exact Host and an exact Origin (EXC-1203), and
        // the browser sends the Vite dev server's own origin (caret.localhost via
        // the caret-vanity-url plugin above) for both. changeOrigin rewrites Host
        // to the target's authority; http-proxy leaves Origin alone, so rewrite
        // that too. Speaking the daemon's own origin is what keeps dev working
        // WITHOUT widening the guard — the daemon still accepts exactly one
        // authority. What keeps this hop from laundering a foreign request is
        // Vite's own `allowedHosts` default (loopback and `*.localhost` only);
        // widening that — a tunnel host for a demo — re-opens both guards in dev.
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => proxyReq.setHeader("origin", DEV_API_TARGET));
        },
      },
    },
  },
});
