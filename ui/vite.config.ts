import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

import { DEFAULT_PORT } from "../src/config/constants.ts";

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
  ],
  resolve: {
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
      // The library statically references shiki/wasm (Oniguruma engine) and both
      // bundled theme collections — its own @pierre/theme/* palettes and shiki's
      // @shikijs/themes/*, the two halves of @pierre/theming's collection — but
      // caret uses the JS regex engine and registers its own themes, so all three
      // are dead at runtime. Aliasing them to a throwing stub keeps ~600 KB of
      // WASM and ~1.8 MB of theme payload out of the build. The theme loaders are
      // lazy, so an unaliased collection costs one emitted chunk per theme rather
      // than entry weight — which is why only the build's total size shows it.
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
      {
        find: /^@shikijs\/themes\/.*/,
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
      "/api": `http://localhost:${process.env.CARET_PORT ?? DEFAULT_PORT}`,
    },
  },
});
