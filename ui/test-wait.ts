// Polls a predicate until it holds or the deadline passes, for component
// suites whose subject paints asynchronously on its own schedule (@pierre/
// diffs repaints after a shared-highlighter init it kicks off from render(),
// a window the library doesn't expose for injection). Awaiting the painted
// DOM keeps those assertions deterministic without fixed sleeps. Logic the
// suite controls should still inject its clock instead of polling — see
// docs/agents/browser-testing.md.
export async function until(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}
