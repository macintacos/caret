// Guards the bare-invocation footgun for the component test harness. Svelte's
// `.` export map is condition-gated: the `browser` condition resolves the client
// runtime (`index-client.js`, the real `mount`); the default resolves the server
// runtime (`index-server.js`, whose `mount` is a stub that throws
// `lifecycle_function_unavailable` deep inside a component mount). So `bun test`
// without `--conditions browser` would mount every component into the server
// stub and crash cryptically. test-mount.ts probes the resolved svelte module at
// import and fails with the message below instead.
//
// Kept node-free and happy-dom-free so the guard's tests import it directly
// without registering happy-dom's DOM globals — those globals leak across files
// in the single bun-test process and break the daemon suite's real fetch.

/** The actionable error message shown when svelte resolves its server runtime —
 * i.e. `bun test` ran without `--conditions browser`. */
export const BARE_INVOCATION_MESSAGE =
  "caret UI component tests require svelte's `browser` export condition. " +
  "Run `mise run test` or `bun test --conditions browser`, not bare " +
  "`bun test` — which resolves svelte's server runtime and makes mount() " +
  "throw cryptically.";

/** True when the `browser` condition picked svelte's client runtime. The server
 * build resolves to `index-server.js`; the client build to `index-client.js`.
 * Pure over the resolved URL so both branches are unit-testable. */
export function isSvelteClientRuntime(resolvedSvelteUrl: string): boolean {
  return resolvedSvelteUrl.endsWith("index-client.js");
}

/** Throws the actionable error unless svelte resolved its client runtime.
 * `import.meta.resolve` reports the exact module the active export conditions
 * picked — i.e. which `mount` the caller imported. */
export function assertSvelteClientRuntime(resolvedSvelteUrl: string): void {
  if (!isSvelteClientRuntime(resolvedSvelteUrl)) {
    throw new Error(BARE_INVOCATION_MESSAGE);
  }
}
