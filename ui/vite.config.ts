import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

import { DEFAULT_PORT } from "../src/config/constants.ts";
import { bundleBudgetPlugin } from "./bundle-budget.ts";

// Hoisted so the `/api` proxy's target and the Origin it rewrites to cannot drift.
const DEV_API_TARGET = `http://localhost:${process.env.CARET_PORT ?? DEFAULT_PORT}`;

// Multi-asset output is deliberate: the binary embeds each hashed asset by URL
// path from a build-generated manifest, and the daemon serves them with per-path
// MIME and cache headers (EXC-522).
export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte(),
    {
      // src/styles/palette.generated.css is gitignored, so it must exist before
      // app.css's @import is resolved — for `vite build` and the dev server alike.
      // Spawned rather than imported: vite bundles this config with esbuild first,
      // and that loader may not honour the UI program's $lib alias transitively.
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
      // stays localhost (browsers resolve *.localhost themselves), and both Vite
      // and the daemon's same-origin guard accept caret.localhost, so the printed
      // link works end-to-end in dev too.
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
    bundleBudgetPlugin(),
  ],
  resolve: {
    // CodeMirror's extension system is identity-sensitive: a Facet, StateField, or
    // Language carries the identity of the module instance that created it, and
    // `EditorState.create` rejects anything it does not recognise as its own. A
    // SECOND physical copy anywhere in the install tree therefore breaks
    // MarkdownEditor.svelte — the editor never constructs, and the surface renders as
    // an empty bordered box. @lezer/common rides along because Tree/NodeType identity
    // flows through the same extensions.
    //
    // What breaks it is the resolved node_modules tree, not bun.lock: bun does not
    // reliably prune a stale nested copy left by an older install, so neither a clean
    // lockfile nor `bun dedupe` / `bun prune` (which act on the lock) is a substitute
    // for an always-on resolution rule.
    dedupe: ["@codemirror/state", "@codemirror/view", "@codemirror/language", "@lezer/common"],
    alias: [
      // The regexp anchors on the `@/` boundary so it matches `@/x` only — never
      // `@core/x` or a scoped package — and so is order-independent against the
      // entries below. Mirrors the ui/tsconfig `@/*` mapping so svelte-check, the
      // vite build, and bun test agree.
      { find: /^@\//, replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/` },
      // The tool-agnostic core in src/: the UI imports the wire contract
      // (src/lib/types.ts) type-only, so no node-only code reaches the bundle.
      // Mirrors the tsconfig `paths` mapping so svelte-check and bun test agree
      // (EXC-507).
      { find: "@core", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
      // The import prefix shadcn-svelte's copied components and components.json
      // assume; the matching tsconfig `paths` entry keeps svelte-check and bun test
      // in step (EXC-757).
      { find: "$lib", replacement: fileURLToPath(new URL("./src/lib", import.meta.url)) },
      // The bare specifier (imported by @pierre/diffs) resolves to caret's shim, which
      // swaps the highlighter's engine (pure-JS regex, not the Oniguruma WASM binary)
      // and themes, and exposes shiki's FULL language bundle so every grammar an agent
      // can tag a fenced block with highlights (EXC-665) — as lazy `() => import(...)`
      // loaders, so vite code-splits one on-demand chunk per grammar. Anchored, so deep
      // specifiers (shiki/core, shiki/langs/*, …) keep resolving to the real package.
      {
        find: /^shiki$/,
        replacement: fileURLToPath(new URL("./src/lib/diffview/shiki-bundle.ts", import.meta.url)),
      },
      // shiki/wasm (the Oniguruma engine) and the ten @pierre/theme/* palettes are
      // reachable only through lazy `import(...)` the library never takes: caret runs
      // the JS regex engine and registers its own themes. Stubbing both keeps ~600 KB
      // of WASM and the pierre theme payloads out of the build.
      //
      // Do NOT add @shikijs/themes/* alongside them, however much it looks like the
      // other half of the same collection — it cost a release-blocking regression to
      // learn. upstream-shiki.ts imports seven of those modules ITSELF as
      // `shiki/themes/<name>.mjs`, one-line re-exports of `@shikijs/themes/<name>` in
      // shiki 4.x, so the stub would replace caret's own vendor palette data (EXC-896:
      // dracula, github-*, catppuccin-*) and every vendor palette a reviewer picks
      // renders unthemed. Nothing caret ships is named pierre-*, which is why the entry
      // below is safe where that one is not.
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
    // `mise run dev` discovers its isolated daemon's ephemeral port from the lock
    // file and exports it as CARET_PORT before Vite starts (EXC-461), so the daemon
    // and this proxy can't diverge; the prod default keeps `vite build` working.
    proxy: {
      "/api": {
        target: DEV_API_TARGET,
        // The daemon gates on an exact Host and an exact Origin (EXC-1203), and the
        // browser sends the Vite dev origin for both. changeOrigin rewrites Host;
        // http-proxy leaves Origin alone, so rewrite that too — speaking the daemon's
        // own origin keeps dev working WITHOUT widening the guard. What stops this hop
        // laundering a foreign request is Vite's `allowedHosts` default (loopback and
        // `*.localhost` only); widening it for a tunnel re-opens both guards in dev.
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => proxyReq.setHeader("origin", DEV_API_TARGET));
        },
      },
    },
  },
});
