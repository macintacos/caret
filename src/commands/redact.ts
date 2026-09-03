// `caret redact`: write shareable scrubbed copies of the state-dir logs
// (EXC-399). Human-facing output, not hook JSON — it prints each written path or
// says nothing was found, and reports failures to stderr with a non-zero exit.

import { redactLogFiles } from "@/redact/node.ts";

export function runRedactSubcommand(): void {
  try {
    const written = redactLogFiles();
    if (written.length === 0) {
      process.stdout.write("caret redact: no logs found to redact.\n");
    } else {
      for (const path of written) process.stdout.write(`${path}\n`);
    }
    process.exit(0);
  } catch (e) {
    process.stderr.write(`caret redact: ${e}\n`);
    process.exit(1);
  }
}
