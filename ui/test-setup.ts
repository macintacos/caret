// Registers happy-dom's DOM globals (document, Range, TreeWalker, Selection,
// Node, NodeFilter) into the Bun test runtime so the anchoring/selection
// modules can exercise real Range/TreeWalker APIs. Imported by each UI test
// file (rather than relied on via bunfig preload) so it works regardless of
// the cwd `bun test` is invoked from, without touching the backend suite.
//
// GlobalRegistrator.register() also overwrites the global fetch/Response/Request/
// Headers with happy-dom's virtual-network versions, which can't reach a real
// loopback socket. The backend suite shares this single bun-test process and
// needs Bun's native fetch; the UI suite stubs fetch itself and constructs
// Response equivalently. So restore the native primitives right after register,
// keeping the DOM but leaving the network stack native — test-file ordering can
// then never break the backend suite (EXC-554).
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!(globalThis as { document?: unknown }).document) {
  // Capture the natives as full descriptors before register so the restore is
  // faithful — Bun's globals are enumerable, and a value-only redefine would
  // leave them non-enumerable (happy-dom's value).
  const keys = ["fetch", "Response", "Request", "Headers"] as const;
  const native = keys.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  GlobalRegistrator.register();
  for (const [key, descriptor] of native) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
  }
}
