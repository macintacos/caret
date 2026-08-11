// Test preload (registered in bunfig.toml's `[test] preload`): point the plan
// formatter at the mise-pinned rumdl already on PATH so the default engine
// (src/plan/rumdl.ts) runs offline — no first-use GitHub download during unit
// tests. ensureRumdl() takes CARET_RUMDL_BIN only when it reports the pinned
// RUMDL_VERSION, so this saves the download exactly when PATH's rumdl matches the
// mise.lock pin. Inert when rumdl isn't on PATH (tests run outside mise) or when
// the var is already set. Backend-only side effect; harmless for the UI suite.
const bin = Bun.which("rumdl");
if (bin && !process.env.CARET_RUMDL_BIN) process.env.CARET_RUMDL_BIN = bin;
