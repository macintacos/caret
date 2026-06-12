import { describe, expect, test } from "bun:test";
import { caretDiffTheme, registerCaretDiffThemes } from "./theme.ts";

// The bridge selects caret's own Shiki themes for the diff view so its
// highlighting matches caret's code blocks exactly, and registers them into
// the library's highlighter exactly once.

describe("caretDiffTheme", () => {
  test("selects caret's light and dark themes, following the system color scheme", () => {
    expect(caretDiffTheme).toEqual({
      theme: { light: "caret-light", dark: "caret-dark" },
      themeType: "system",
    });
  });
});

describe("registerCaretDiffThemes", () => {
  test("registers both caret themes under their selected names", () => {
    const registered: string[] = [];
    registerCaretDiffThemes((name) => {
      registered.push(name);
    });

    expect(registered).toEqual(["caret-light", "caret-dark"]);
  });

  test("registers each theme with a loader resolving to the named theme object", async () => {
    const loaders = new Map<string, () => Promise<unknown>>();
    registerCaretDiffThemes((name, load) => {
      loaders.set(name, load);
    });

    const light = (await loaders.get("caret-light")?.()) as { name: string };
    const dark = (await loaders.get("caret-dark")?.()) as { name: string };
    // The library resolves a theme by the name it was registered under, so the
    // loaded object must carry that exact name.
    expect(light.name).toBe("caret-light");
    expect(dark.name).toBe("caret-dark");
  });
});
