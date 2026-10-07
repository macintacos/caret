// The published entrypoint OpenCode imports when `@macintacos/caret` appears in a
// user's plugin list. OpenCode's loader rejects a module on its first non-plugin export,
// and caret.plugin.ts also exports test helpers, so this re-exports only its default.
// TODO(EXC-1600): OpenCode v2 is withheld from the published package until it is live-checked on
// real hosts. Re-enabling it means default-exporting `{ id: "caret", setup, server }`
// (setup from caret.plugin.v2.ts, server importing this file lazily so a v2 load never
// evaluates @opencode-ai/plugin) and restoring package.json's `exports["./tui"]`.
export { default } from "./caret.plugin.ts";
