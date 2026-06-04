import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// The daemon serves the built SPA from memory as a single HTML document, so the
// build MUST inline all JS + CSS into one ui/dist/index.html with no siblings.
// No dynamic import() anywhere — singlefile cannot inline async chunks.
export default defineConfig({
  plugins: [svelte(), viteSingleFile()],
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
      "/api": `http://localhost:${process.env.CARET_PORT ?? 42718}`,
    },
  },
});
