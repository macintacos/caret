import { mount } from "svelte";

import App from "@/App.svelte";
import "@/app.css";
import { startLogBridge, uiLog } from "$lib/log.ts";
import { applyTheme, readThemeId } from "$lib/theme.ts";

// Apply the saved theme before the first paint so there's no flash of the app.css
// default when the two differ (EXC-730). No wipe at boot — that's only for a
// user-initiated switch (lib/themeWipe.ts).
applyTheme(readThemeId());

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
