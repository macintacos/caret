// The published entrypoint OpenCode imports when `@macintacos/caret` appears in a
// user's plugin list. One default export serves both runtimes: OpenCode v2 decodes
// `{ id, setup }` and ignores `server`; OpenCode v1 (>= 1.3.4) runs `server` and ignores
// `setup`. v1's loader also rejects a module on its first non-plugin export, so the
// namespace stays exactly `{ default }`.
import server from "./caret.plugin.ts";
import setup from "./caret.plugin.v2.ts";

export default { id: "caret", setup, server };
