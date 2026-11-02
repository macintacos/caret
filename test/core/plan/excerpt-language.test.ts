import { expect, test } from "bun:test";

import { languageForPath } from "@/plan/excerpt-language.ts";

test("a path's extension picks the grammar it previews in, whatever its case", () => {
  expect(languageForPath("ui/src/App.TSX")).toBe("tsx");
  expect(languageForPath("scripts/build.config.ts")).toBe("typescript");
});

test("a dotfile, a bare name and an unmapped extension preview as text", () => {
  expect(languageForPath("home/.bashrc")).toBe("text");
  expect(languageForPath("Makefile")).toBe("text");
  expect(languageForPath("notes.xyz")).toBe("text");
});
