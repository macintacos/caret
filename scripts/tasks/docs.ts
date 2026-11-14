// `docs` tasks: build and preview the zensical site under docs/ (config: zensical.toml).
import { execAndExit, runForward } from "@/tasks/lib/exec.ts";

export function docsBuildCommand(): string[] {
  return ["uv", "run", "--locked", "zensical", "build", "--clean", "--strict"];
}

/** 2273 spells CARE on a phone keypad; zensical's default 8000 is often taken. */
export function docsServeCommand(args: string[]): string[] {
  return ["uv", "run", "--locked", "zensical", "serve", "--dev-addr", "localhost:2273", ...args];
}

// zensical rewrites every link to a page it built into a directory URL, so a
// site-internal href still ending in .md names a page the build did not produce —
// a nav entry for a missing or excluded page, which --strict lets through.
const UNBUILT_PAGE_HREF = /href="(?!https?:\/\/)([^"]*\.md(?:#[^"]*)?)"/g;

export function unbuiltPageLinks(html: string): string[] {
  return [...html.matchAll(UNBUILT_PAGE_HREF)].map((match) => match[1] ?? "");
}

export async function runDocsBuild(): Promise<never> {
  // runForward resolves the child's exit code (stdio inherited).
  const code = await runForward(docsBuildCommand());
  if (code !== 0) process.exit(code);

  // mise runs file tasks from the repo root, and zensical writes site/ there.
  const offenders: { page: string; links: string[] }[] = [];
  for await (const page of new Bun.Glob("**/*.html").scan({ cwd: "site" })) {
    const links = unbuiltPageLinks(await Bun.file(`site/${page}`).text());
    if (links.length > 0) offenders.push({ page, links });
  }
  const [first, ...rest] = offenders;
  if (first === undefined) process.exit(0);

  console.error(
    `docs:build: site/${first.page} links ${first.links.join(", ")}, a page the build did not produce` +
      (rest.length > 0 ? ` (and ${rest.length} more pages do too)` : "") +
      ". Check zensical.toml's nav for a missing or excluded page.",
  );
  process.exit(1);
}

export async function runDocsServe(args: string[]): Promise<never> {
  return execAndExit(docsServeCommand(args));
}
