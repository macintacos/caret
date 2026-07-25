import { mount } from "svelte";

import App from "@/App.svelte";
import "@/app.css";
import { applyAppearance, migrateLegacyTheme } from "$lib/appearance.ts";
import { startLogBridge, uiLog } from "$lib/log.ts";

// Carry a pre-mode single-theme pick over to the mode + slots model before
// anything reads the appearance, so an existing user's explicit choice survives
// the new `system` default (EXC-773).
migrateLegacyTheme();

// Paint the saved appearance before the first paint so there's no flash of the
// app.css default when the two differ (EXC-730). Instant, not a wipe: every other
// appearance change wipes (lib/themeWipe.ts), but boot has no previous frame to
// transition from.
applyAppearance();

// Mark the browser tab in dev so it's distinguishable from an installed build.
// `import.meta.env.DEV` is true only under `vite` (mise run dev); the embedded
// prod build ships it false, so the tab keeps its plain title there.
if (import.meta.env.DEV) document.title = document.title.replace("caret", "caret (dev)");

const target = document.getElementById("app");
if (!target) throw new Error("#app mount target not found");

// Install the UI → daemon log bridge (EXC-445) before anything that can log or
// await, so events emitted during a slow boot still flush on an early pagehide.
startLogBridge();

const app = mount(App, { target });

// A single boot event so the daemon timeline shows when a browser session came
// up.
uiLog.info("ui", "ui loaded");

export default app;
