// The published entrypoint OpenCode imports when `@macintacos/caret` appears in a
// user's plugin list. One default export serves both runtimes: OpenCode v2 decodes
// `{ id, setup }` and ignores `server`; OpenCode v1 (>= 1.3.4) runs `server` and ignores
// `setup`. v1's loader also rejects a module on its first non-plugin export, so the
// namespace stays exactly `{ default }`. `server` imports the v1 plugin on its first call,
// so a v2 load never evaluates `@opencode-ai/plugin`; v1 only checks that `server` is a
// function (anomalyco/opencode@v1.3.4 packages/opencode/src/plugin/shared.ts:142).
import type v1Plugin from "./caret.plugin.ts";
import setup from "./caret.plugin.v2.ts";

const server: typeof v1Plugin = async (...args) =>
  (await import("./caret.plugin.ts")).default(...args);

export default { id: "caret", setup, server };
