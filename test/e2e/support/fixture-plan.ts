// Synthetic plan fixture for the e2e specs. Deliberately generic,
// non-identifying content (no real paths, names, or project details): failure
// traces/screenshots capture rendered plan text, so the fixture itself must be
// shareable. Shape mirrors a real plan: several headings (the breadcrumbs bar), a
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

const tallSection = (label: string) =>
  Array.from({ length: 40 }, (_, i) => `${label} line ${i + 1} keeps the plan tall.`).join("\n");

/** A plan several viewports tall, for specs that need genuine scrolling — an
 * overscroll gap below the last line, or a composer opening below the fold. */
export const TALL_PLAN = [
  "# Alpha",
  tallSection("Alpha"),
  "## Bravo",
  tallSection("Bravo"),
  "## Charlie",
  tallSection("Charlie"),
  "",
].join("\n\n");

/** A second, distinguishable plan for multi-review specs (switcher/deep link). */
export const SECOND_PLAN = `# Gadget Renderer Cleanup

This plan trims the gadget renderer's unused layout passes.

## Scope

Only the renderer module changes; public interfaces stay frozen.
`;

/** `count` short, distinguishable filler lines under `label`, joined by blank lines. */
export const bodyFiller = (label: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${label} body line ${i + 1}.`).join("\n\n");

/** A three-heading plan (Alpha/Bravo/Charlie), `linesPerSection` `bodyFiller` lines
 * under each — tall enough for gg/G, half-page, and heading-jump motion to have
 * somewhere to go, with three headings so heading jumps have distinct targets. */
export function headedFillerPlan(linesPerSection: number): string {
  return [
    "# Alpha",
    bodyFiller("Alpha", linesPerSection),
    "## Bravo",
    bodyFiller("Bravo", linesPerSection),
    "## Charlie",
    bodyFiller("Charlie", linesPerSection),
    "",
  ].join("\n\n");
}
