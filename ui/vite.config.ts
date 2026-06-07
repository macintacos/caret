import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { DEFAULT_PORT } from "../src/constants.ts";

// A standard multi-asset build: Vite emits dist/index.html plus content-hashed
// dist/assets/* (JS + CSS). The binary embeds each asset by URL path via a
// build-generated manifest, and the daemon serves them with per-path MIME and
// cache headers (EXC-522).
export default defineConfig({
  plugins: [
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
    // build, keeping the singlefile bundle free of node-only code; the matching
    // tsconfig `paths` mappings keep svelte-check and bun test in step (EXC-507).
    alias: { "@core": fileURLToPath(new URL("../src", import.meta.url)) },
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
