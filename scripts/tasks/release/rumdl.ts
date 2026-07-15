// Thin `rumdl` shell-out behind the RumdlOps interface, mirroring github.ts /
// npm.ts: the interface lets finalize be driven by a fake in tests, while
// createRumdl() is the real implementation. finalize uses it to reflow the
// GitHub Release notes — the changelog section is hard-wrapped at ~90 chars
// (repo convention), which renders as awkward mid-sentence breaks on GitHub, so
// reflowing to single-line paragraphs (MD013.reflow with an effectively-
// unbounded line length) is what makes the published notes read cleanly.

import { $ } from "bun";

export interface RumdlOps {
  /** Reflow markdown to single-line paragraphs (hard wraps collapsed, fenced
   * code and list structure preserved). Returns the input untouched when it is
   * blank, avoiding a pointless subprocess. */
  reflow(markdown: string): Promise<string>;
}

/** Constructs the real, rumdl-backed RumdlOps. Pinned via mise (`rumdl = latest`
 * in mise.toml, version-locked in mise.lock), invoked as `mise x rumdl` so it
 * resolves the same binary the repo's format task uses. */
export function createRumdl(): RumdlOps {
  return {
    async reflow(markdown) {
      if (markdown.trim() === "") return markdown;
      // `line_length=9999999` makes every paragraph fit on one line, so
      // `reflow=true` joins the hard-wrapped source lines rather than rewrapping
      // them to a fixed width. stdin carries the markdown; stdout is the result.
      const out =
        await $`mise x rumdl -- rumdl fmt - --config MD013.reflow=true --config MD013.line_length=9999999 < ${Buffer.from(markdown)}`.text();
      return out;
    },
  };
}
