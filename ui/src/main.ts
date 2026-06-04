import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { initHighlighter } from "./lib/highlight.ts";
import { startLogBridge, uiLog } from "./lib/log.ts";

const target = document.getElementById("app");
if (!target) throw new Error("#app mount target not found");

// Create the shiki highlighter before the first render so renderPlan() can stay
// synchronous. A failed init degrades to plain <pre> (highlightToHtml returns
// null when the highlighter is absent) rather than blocking the app.
await initHighlighter().catch(() => {});

const app = mount(App, { target });

// Install the UI → daemon log bridge (EXC-445) and emit a single boot event so
// the daemon timeline shows when a browser session came up. Call-site
// instrumentation lands separately (EXC-446).
startLogBridge();
uiLog.info("ui", "ui loaded");

export default app;
