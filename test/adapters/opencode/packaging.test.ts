import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadOpencodePackaging } from "@/adapters/opencode/packaging.ts";

// loadOpencodePackaging is tested with an explicit root (the resolveCaretRoot
// argv/execPath detection is exercised by the install.sh integration + manual
// runs, not unit tests — under `bun test` argv[1] is the test runner, not caret).
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "caret-pkg-"));
  await mkdir(join(root, "opencode", "commands"), { recursive: true });
  await writeFile(
    join(root, "opencode", "caret.plugin.ts"),
    `const CARET_PLUGIN_VERSION = "__CARET_VERSION__";\n// plugin body\n`,
  );
  await writeFile(join(root, "opencode", "commands", "demo.md"), "# demo\n");
  await writeFile(join(root, "opencode", "commands", "discovery.md"), "# discovery\n");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("loadOpencodePackaging reads the bin path and sorted command files", () => {
  const pkg = loadOpencodePackaging(root);
  expect(pkg.binPath).toBe(join(root, "bin", "caret"));
  expect(pkg.commands.map((c) => c.name)).toEqual(["demo.md", "discovery.md"]);
  expect(pkg.commands[0]?.contents).toContain("demo");
});

test("loadOpencodePackaging tolerates a missing commands dir (the array entry alone is valid)", async () => {
  await rm(join(root, "opencode", "commands"), { recursive: true, force: true });
  const pkg = loadOpencodePackaging(root);
  expect(pkg.commands).toEqual([]);
  expect(pkg.binPath).toBe(join(root, "bin", "caret"));
});
