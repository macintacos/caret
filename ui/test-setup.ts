// Registers happy-dom's DOM globals (document, Range, TreeWalker, Selection,
// Node, NodeFilter) into the Bun test runtime so the anchoring/selection
// modules can exercise real Range/TreeWalker APIs. Imported by each UI test
// file (rather than relied on via bunfig preload) so it works regardless of
// the cwd `bun test` is invoked from, without touching the backend suite.
//
// GlobalRegistrator.register() also overwrites globals the backend suite needs in
// their native form, and the two suites share one bun-test process, so whichever
// file registers first would otherwise decide whether the backend passes. Restore
// those right after register — the DOM stays happy-dom's, these stay Bun's, and
// test-file ordering can never break the backend suite:
//
//   - fetch/Response/Request/Headers — happy-dom's are virtual-network versions
//     that can't reach a real loopback socket, which the backend suite needs and
//     the UI suite doesn't (it stubs fetch and constructs Response itself).
//     EXC-554.
//   - AbortController/AbortSignal — `node:events` rejects a happy-dom signal
//     outright (ERR_INVALID_ARG_TYPE), and listr2 hands its own controller's
//     signal to setMaxListeners from the Listr constructor, so scripts/preflight.ts
//     could not build a task list at all. Restored as a pair: a native controller
//     under a happy-dom `AbortSignal` global would leave `signal instanceof
//     AbortSignal` false, which is a worse trap than the one being fixed.
//     EXC-1080.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!(globalThis as { document?: unknown }).document) {
  // Capture the natives as full descriptors before register so the restore is
  // faithful — Bun's globals are enumerable, and a value-only redefine would
  // leave them non-enumerable (happy-dom's value).
  const keys = [
    "fetch",
    "Response",
    "Request",
    "Headers",
    "AbortController",
    "AbortSignal",
  ] as const;
  const native = keys.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  GlobalRegistrator.register();
  for (const [key, descriptor] of native) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
  }
}
