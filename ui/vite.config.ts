import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { DEFAULT_PORT } from "../src/constants.ts";

// The daemon serves the built SPA from memory as a single HTML document, so the
// build MUST inline all JS + CSS into one ui/dist/index.html with no siblings.
// No dynamic import() anywhere — singlefile cannot inline async chunks.
export default defineConfig({
  plugins: [
    svelte(),
    viteSingleFile(),
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
    // build, keeping the singlefile bundle free of node-only code; the matching
    // tsconfig `paths` mappings keep svelte-check and bun test in step (EXC-507).
    alias: { "@core": fileURLToPath(new URL("../src", import.meta.url)) },
  },
  build: {
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
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
