// The accents the review page shows, kept for the menubar app's card. The theme choice
// lives in the browser, so the page reports both slots' accents (PUT /api/accent) and the
// daemon keeps the last report on disk, where a restart and an idle exit can't lose it.

import { dirname } from "node:path";

import { z } from "zod";

import { ensureStateDir } from "@/config/paths.ts";
import { writeFileAtomic } from "@/lib/atomic-write.ts";
import { readJsonFileSync } from "@/lib/json-file.ts";
import { createKeyedQueue } from "@/lib/keyed-queue.ts";
import type { SchemeAccents } from "@/lib/types.ts";
import { ColorSchema } from "@/theme/schema.ts";

export const SchemeAccentsSchema = z.object({
  light: ColorSchema,
  dark: ColorSchema,
}) satisfies z.ZodType<SchemeAccents>;

export interface AccentStore {
  /** The last report, or undefined when none was kept or the file no longer parses. */
  read(): SchemeAccents | undefined;
  write(accents: SchemeAccents): Promise<void>;
}

export function createAccentStore(path: string): AccentStore {
  const writes = createKeyedQueue();
  return {
    read() {
      const parsed = SchemeAccentsSchema.safeParse(readJsonFileSync(path));
      return parsed.success ? parsed.data : undefined;
    },
    write({ light, dark }) {
      return writes.run(path, async () => {
        ensureStateDir(dirname(path));
        await writeFileAtomic(path, JSON.stringify({ light, dark }), { mode: 0o600 });
      });
    },
  };
}
