import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { initHighlighter } from "./lib/highlight.ts";

const target = document.getElementById("app");
if (!target) throw new Error("#app mount target not found");

// Create the shiki highlighter before the first render so renderPlan() can stay
// synchronous. A failed init degrades to plain <pre> (highlightToHtml returns
// null when the highlighter is absent) rather than blocking the app.
await initHighlighter().catch(() => {});

const app = mount(App, { target });

export default app;
