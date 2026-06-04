import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { initHighlighter } from "./lib/highlight.ts";
import { startLogBridge, uiLog } from "./lib/log.ts";

const target = document.getElementById("app");
if (!target) throw new Error("#app mount target not found");

// Install the UI → daemon log bridge (EXC-445) before anything that can log or
// await, so events emitted during a slow boot still flush on an early pagehide.
startLogBridge();

// Create the shiki highlighter before the first render so renderPlan() can stay
// synchronous. A failed init degrades to plain <pre> (highlightToHtml returns
// null when the highlighter is absent) rather than blocking the app.
await initHighlighter().catch(() => {});

const app = mount(App, { target });

// A single boot event so the daemon timeline shows when a browser session came
// up.
uiLog.info("ui", "ui loaded");

export default app;
