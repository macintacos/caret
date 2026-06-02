// Registers happy-dom's DOM globals (document, Range, TreeWalker, Selection,
// Node, NodeFilter) into the Bun test runtime so the anchoring/selection
// modules can exercise real Range/TreeWalker APIs. Imported by each UI test
// file (rather than relied on via bunfig preload) so it works regardless of
// the cwd `bun test` is invoked from, without touching the backend suite.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!(globalThis as { document?: unknown }).document) {
  GlobalRegistrator.register();
}
