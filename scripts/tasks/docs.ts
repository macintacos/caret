// `docs` tasks: build and preview the zensical site under docs/ (config: zensical.toml).
import { execAndExit, runForward, writeAndFlush } from "@/tasks/lib/exec.ts";

export function docsBuildCommand(): string[] {
  return ["uv", "run", "--locked", "zensical", "build", "--clean", "--strict"];
}

/** 2273 spells CARE on a phone keypad; zensical's default 8000 is often taken. */
export function docsServeCommand(args: string[]): string[] {
  return ["uv", "run", "--locked", "zensical", "serve", "--dev-addr", "localhost:2273", ...args];
}

const UNBUILT_PAGE_HREF = /href="(?!https?:\/\/)([^"]*\.md(?:#[^"]*)?)"/g;

/**
 * Site-internal hrefs still ending in .md: zensical rewrites every link to a page it
 * built into a directory URL, so these name a page the build did not produce (a nav
 * entry for a missing or excluded page, which --strict lets through).
 */
export function unbuiltPageLinks(html: string): string[] {
  return [...html.matchAll(UNBUILT_PAGE_HREF)].map((match) => match[1] ?? "");
}

/** The `docs:build` failure message for a built site, or null when every page's links resolve. */
export function unbuiltPageReport(pages: Iterable<{ page: string; html: string }>): string | null {
  let scanned = 0;
  const offenders: { page: string; links: string[] }[] = [];
  for (const { page, html } of pages) {
    scanned++;
    const links = unbuiltPageLinks(html);
    if (links.length > 0) offenders.push({ page, links });
  }
  if (scanned === 0) return "docs:build: site/ holds no HTML pages, so nothing was checked.";

  const [firstOffender, ...otherOffenders] = offenders;
  if (firstOffender === undefined) return null;
  return (
    `docs:build: site/${firstOffender.page} links pages the build did not produce: ${firstOffender.links.join(", ")}` +
    (otherOffenders.length > 0 ? ` (and ${otherOffenders.length} more pages do too)` : "") +
    ". Check zensical.toml's nav for a missing or excluded page."
  );
}

export async function runDocsBuild(): Promise<never> {
  const code = await runForward(docsBuildCommand());
  if (code !== 0) process.exit(code);

  // mise runs file tasks from the repo root, and zensical writes site/ there.
  const pages: { page: string; html: string }[] = [];
  for await (const page of new Bun.Glob("**/*.html").scan({ cwd: "site" })) {
    pages.push({ page, html: await Bun.file(`site/${page}`).text() });
  }
  const report = unbuiltPageReport(pages);
  if (report === null) process.exit(0);

  await writeAndFlush(process.stderr, `${report}\n`);
  process.exit(1);
}

export async function runDocsServe(args: string[]): Promise<never> {
  return execAndExit(docsServeCommand(args));
}
