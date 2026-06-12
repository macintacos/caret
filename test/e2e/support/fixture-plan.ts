// Synthetic plan fixture for the e2e specs. Deliberately generic,
// non-identifying content (no real paths, names, or project details): failure
// traces/screenshots capture rendered plan text, so the fixture itself must be
// shareable. Shape mirrors a real plan: several headings (TOC + scrollspy), a
// language-tagged code block (shiki highlight path), and stable paragraph text
// the annotation spec targets by content.

export const FIXTURE_PLAN = `# Widget Cache Refactor

This plan reorganizes the widget cache so lookups stay warm across restarts.

## Background

The cache layer keeps a warm copy of each manifest in memory today. Restarts
drop every entry, so the first lookup after a deploy pays the full cold cost.

## Approach

Persist the manifest index to a sidecar file on every write. On boot, the
loader replays the sidecar before serving, so the first lookup is already warm.

\`\`\`ts
function warm(index: ManifestIndex): Cache {
  return Cache.fromEntries(index.entries());
}
\`\`\`

## Verification

Run the loader against a recorded sidecar and confirm the first lookup is a
cache hit. Cold-start timings should match warm-path timings within noise.
`;

/** A second, distinguishable plan for multi-review specs (switcher/deep link). */
export const SECOND_PLAN = `# Gadget Renderer Cleanup

This plan trims the gadget renderer's unused layout passes.

## Scope

Only the renderer module changes; public interfaces stay frozen.
`;
