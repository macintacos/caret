// Test preload (registered in bunfig.toml's `[test] preload`): point the plan
// formatter at the mise-pinned rumdl already on PATH so src/plan/rumdl.ts runs
// offline — no first-use GitHub download during unit tests.
const bin = Bun.which("rumdl");
if (bin && !process.env.CARET_RUMDL_BIN) process.env.CARET_RUMDL_BIN = bin;
