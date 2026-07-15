// The published entrypoint OpenCode imports when `@macintacos/caret` appears in a
// user's `plugin` array. OpenCode's loader iterates a plugin module's exports
// (Object.values) and rejects the whole module on the FIRST export that isn't a
// Plugin — and caret.plugin.ts additionally exports test helpers/constants for
// test/opencode/. So this file re-exports ONLY the default plugin, leaving a module
// namespace of exactly `{ default }`. (This is why the array path does not need the
// deploy-time `stripNonDefaultExports` the retired file-deploy relied on.)
export { default } from "./caret.plugin.ts";
