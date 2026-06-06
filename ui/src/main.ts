import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { initHighlighter } from "./lib/highlight.ts";
import { markHighlightReady } from "./lib/highlightReady.svelte.ts";
import { startLogBridge, uiLog } from "./lib/log.ts";

const target = document.getElementById("app");
if (!target) throw new Error("#app mount target not found");

// Install the UI → daemon log bridge (EXC-445) before anything that can log or
// await, so events emitted during a slow boot still flush on an early pagehide.
startLogBridge();

// Build the shiki highlighter OFF the critical path so first paint isn't gated
// on its async construction. renderPlan() stays synchronous and falls back to
// plain <pre> (highlightToHtml returns null while the highlighter is absent);
// markHighlightReady() then flips the reactive signal App watches to repaint
// the active plan with highlighting. A failed init degrades to plain <pre>.
void initHighlighter()
	.then(markHighlightReady)
	.catch(() => {});

const app = mount(App, { target });

// A single boot event so the daemon timeline shows when a browser session came
// up.
uiLog.info("ui", "ui loaded");

export default app;
