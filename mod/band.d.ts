declare module "claude-code" {
  interface PluginState {
    caret: { band: { session: string; url: string; owner: string } | null };
  }
}
