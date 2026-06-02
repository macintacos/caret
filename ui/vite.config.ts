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
    // `mise run dev` proxies the JSON API to the running daemon.
    proxy: {
      "/api": "http://localhost:42718",
    },
  },
});
