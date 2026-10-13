import "@ui/support/mount.ts";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { LogCapture } from "@ui/support/helpers.ts";
import {
  emptyResponse,
  installRoutedFetch,
  jsonResponse,
  type Respond,
} from "@ui/support/routed-fetch.ts";
import { customThemeSource } from "@ui/support/theme-file.ts";
import { appearance } from "@/state/appearance.svelte.ts";
import { isCustomThemeId, themesForScheme } from "$lib/theme.ts";
import { uploadThemeFile } from "$lib/themeUpload.ts";

afterEach(() => {
  localStorage.clear();
  appearance.boot();
});

let seq = 0;
/** The runtime registry is module-global and refuses a repeat id. */
const uniqueId = () => `upload-${++seq}`;

describe("uploadThemeFile", () => {
  let respond: Respond;
  let cap: LogCapture;
  beforeEach(() => {
    respond = emptyResponse;
    cap = installRoutedFetch(() => respond);
  });
  afterEach(() => cap.restore());

  const upload = (text: string) => uploadThemeFile(new File([text], "nightly.json"));

  test("a new theme joins its slot and the message names its label and scheme", async () => {
    const theme = await customThemeSource(uniqueId(), "dark");
    respond = () => Promise.resolve(jsonResponse({ theme, errors: [], unremoved: [] }));

    const outcome = await upload(JSON.stringify(theme));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.message).toContain(theme.label);
    expect(outcome.message).toContain("dark");
    expect(themesForScheme("dark").some((t) => t.id === theme.id)).toBe(true);
  });

  test("a registered id is replaced", async () => {
    const theme = await customThemeSource(uniqueId(), "dark");
    respond = () => Promise.resolve(jsonResponse({ theme, errors: [], unremoved: [] }));
    await upload(JSON.stringify(theme));

    const outcome = await upload(JSON.stringify(theme));

    expect(outcome.ok && outcome.message.startsWith("Replaced")).toBe(true);
  });

  test("a saved theme that can't be registered asks for a reload", async () => {
    const theme = await customThemeSource("caret-dark", "dark");
    respond = () => Promise.resolve(jsonResponse({ theme, errors: [], unremoved: [] }));

    const outcome = await upload(JSON.stringify(theme));

    expect(outcome.ok && outcome.message.includes("Reload")).toBe(true);
  });

  test("a save that left a clashing file names it and registers nothing", async () => {
    const theme = await customThemeSource(uniqueId(), "dark");
    respond = () =>
      Promise.resolve(jsonResponse({ theme, errors: [], unremoved: ["NIGHTLY.json"] }));

    const outcome = await upload(JSON.stringify(theme));

    expect(outcome.ok && outcome.message.includes("NIGHTLY.json")).toBe(true);
    expect(isCustomThemeId(theme.id)).toBe(false);
  });

  test("a refusal carries the file name and each line", async () => {
    respond = () =>
      Promise.resolve(Response.json({ errors: ["upload: a", "upload: b"] }, { status: 400 }));

    expect(await upload("{}")).toEqual({
      ok: false,
      file: "nightly.json",
      errors: ["upload: a", "upload: b"],
    });
  });

  test("the folder's load errors pass through", async () => {
    const theme = await customThemeSource(uniqueId(), "light");
    const errors = [{ file: "old.json", messages: ["bad"] }];
    respond = () => Promise.resolve(jsonResponse({ theme, errors, unremoved: [] }));

    const outcome = await upload(JSON.stringify(theme));

    expect(outcome.ok && outcome.loadErrors).toEqual(errors);
  });
});
