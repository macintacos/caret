---
name: icon-rules
description: Conventions for caret's vendored Lucide icons — verbatim SVGs, the Icon.svelte render path, and the checklist for adding one.
---

# Icon Rules

caret's icons are [Lucide](https://lucide.dev) SVGs vendored verbatim into `ui/src/icons/`, one file
per icon, copied from a single pinned Lucide release (EXC-395):

- **`ui/src/icons/` holds only verbatim Lucide SVGs.** They are never edited by hand and no formatter
  touches them — sizing and color are CSS concerns owned by `Icon.svelte`, not edits to the files.
- **The whole set rides one pinned tag.** Every icon is fetched from the same Lucide release; if you
  upgrade, bump all of them together rather than mixing tags.

`ui/src/lib/icons.ts` is a pure-TS registry: it exports `ICON_NAMES` (the source of truth for which
icons exist) and the `IconName` type. `ui/src/lib/icons.test.ts` enforces the registry↔directory
bijection and the verbatim-file invariants, so a drifting set fails `bun test`.

## How icons render

`ui/src/components/Icon.svelte` renders one icon by `name`:

- **Static `?raw` imports only.** Each SVG is imported as a `?raw` string and inlined via `{@html}`,
  which keeps the singlefile build (`vite-plugin-singlefile`) safe — no emitted assets. Never reach
  for a dynamic import; it would break the single-file bundle.
- **`name`** is an `IconName` from `ICON_NAMES` — the registry, not a free string.
- **`size`** is a px prop (square) applied as CSS on the wrapper, overriding the SVG's own
  width/height. Color rides on `stroke="currentColor"` from the parent's `color`.
- **`label`** sets an `aria-label` for an interactive or informative icon; omit it for a decorative
  icon, which then renders `aria-hidden`.

## Adding an icon

1. Fetch `https://raw.githubusercontent.com/lucide-icons/lucide/<pinned-tag>/icons/<name>.svg` into
   `ui/src/icons/` (keep the whole set on one pinned tag — bump every icon together if you upgrade).
2. Add the name to `ICON_NAMES` in `ui/src/lib/icons.ts`.
3. Add the static `?raw` import and the `SVGS` map entry in `ui/src/components/Icon.svelte`.
4. Add the row to `THIRD_PARTY_LICENSES.md` (and update its pinned tag there if it changed).
5. Run `bun test` — `icons.test.ts` enforces the registry↔directory bijection and the file
   invariants.

## Restraint

An icon must earn its place: reach for one only when it carries meaning a label alone can't, not as
decoration. In particular, the `^` brand mark is caret's brand identity and is never replaced by an
icon.
