// Reactive signal for shiki highlighter readiness.
//
// main.ts kicks off initHighlighter() off the critical path so first paint is
// not gated on shiki's async build (the plan renders immediately with plain
// <pre>). When the build resolves, main.ts calls markHighlightReady(); App
// reads highlightReady() to repaint the active plan once shiki is available.
//
// A .svelte.ts module so the flag is a rune ($state) App can react to. Not
// imported by any bun test — the first-paint ordering it drives is real-browser
// behavior, verified by e2e (per browser-testing.md).

let ready = $state(false);

/** Whether the shiki highlighter has finished its async build. */
export function highlightReady(): boolean {
	return ready;
}

/** Mark the highlighter ready; idempotent. Called once when init resolves. */
export function markHighlightReady(): void {
	ready = true;
}
