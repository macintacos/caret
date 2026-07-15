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
    // the wire contract (src/types.ts) directly. Type-only imports erase at
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
      { find: "@core", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
      // `$lib` → ui/src/lib, the import prefix shadcn-svelte's copied components
      // and components.json assume. Mirrors the @core mapping; the matching
      // tsconfig `paths` entry keeps svelte-check and bun test in step (EXC-757).
      { find: "$lib", replacement: fileURLToPath(new URL("./src/lib", import.meta.url)) },
      {
        find: /^shiki$/,
        replacement: fileURLToPath(new URL("./src/lib/diffview/shiki-bundle.ts", import.meta.url)),
      },
      // The library statically references shiki/wasm (Oniguruma engine) and the
      // @pierre/theme/* bundles, but caret uses the JS regex engine and its own
      // themes, so both are dead at runtime. Aliasing them to a throwing stub
      // keeps ~600 KB of WASM and the pierre theme payloads out of the build.
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
      "/api": `http://localhost:${process.env.CARET_PORT ?? DEFAULT_PORT}`,
    },
  },
});
