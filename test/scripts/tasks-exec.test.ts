import { describe, expect, test } from "bun:test";

import { lastDisplayLine, runCapture } from "@/tasks/lib/exec.ts";

const ESC = String.fromCharCode(27);

describe("lastDisplayLine", () => {
  test("returns the last non-empty line of a chunk", () => {
    expect(lastDisplayLine("first\nsecond\n")).toBe("second");
  });

  test("strips ANSI control sequences and surrounding whitespace", () => {
    expect(lastDisplayLine(`${ESC}[2K${ESC}[1m  transforming...  ${ESC}[0m\n`)).toBe(
      "transforming...",
    );
  });

  test("returns undefined when the chunk holds no displayable text", () => {
    expect(lastDisplayLine(`\n  \n${ESC}[2K\n`)).toBeUndefined();
  });
});

describe("runCapture", () => {
  test("delivers both the child's stdout and stderr to the sink", async () => {
    const chunks: string[] = [];
    const code = await runCapture(
      ["bun", "-e", "console.log('out'); console.error('err')"],
      (chunk) => chunks.push(chunk),
    );
    expect(code).toBe(0);
    expect(chunks.join("")).toContain("out");
    expect(chunks.join("")).toContain("err");
  });

  test("resolves a failing child's exit code", async () => {
    const code = await runCapture(["bun", "-e", "process.exit(3)"], () => {});
    expect(code).toBe(3);
  });

  // The whole point of runCapture over runForward: nothing the child writes may
  // reach THIS process's stdio, or it would scribble over the caller's spinner.
  // A probe process calls runCapture on a grandchild and reports its result on
  // stderr, so an empty probe stdout proves the grandchild's `out` never leaked,
  // and a stderr holding only the report proves the same for its `err`.
  test("writes nothing to this process's stdio", async () => {
    // Resolved from this file rather than written relative to a cwd the probe
    // does not inherit — `bun -e` has no importer path of its own to resolve from.
    const execModule = Bun.fileURLToPath(
      new URL("../../scripts/tasks/lib/exec.ts", import.meta.url),
    );
    const probe = Bun.spawn(
      [
        "bun",
        "-e",
        `import { runCapture } from ${JSON.stringify(execModule)};
         const code = await runCapture(["bun", "-e", "console.log('out'); console.error('err')"], () => {});
         process.stderr.write("probe:" + code);`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [out, err] = await Promise.all([
      new Response(probe.stdout).text(),
      new Response(probe.stderr).text(),
      probe.exited,
    ]);
    expect(out).toBe("");
    expect(err).toBe("probe:0");
  });
});
