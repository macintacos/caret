#!/usr/bin/env bun
// Writes docs/theme.schema.json from the theme file zod schema. Regenerate with
// `bun scripts/generate-theme-schema.ts && mise run format` — Biome reflows the JSON,
// and test/core/theme/schema.test.ts fails while the committed file drifts.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { themeFileJsonSchema } from "@/theme/schema.ts";

writeFileSync(
  join(import.meta.dir, "../docs/theme.schema.json"),
  `${JSON.stringify(themeFileJsonSchema(), null, 2)}\n`,
);
