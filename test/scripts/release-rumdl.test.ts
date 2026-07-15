// Exercises the real rumdl-backed reflow the release pipeline uses to normalize
// GitHub Release notes: hard-wrapped changelog paragraphs must collapse to
// single lines (MD013.reflow with an effectively-unbounded line length). This
// runs the actual `mise x rumdl` binary — no release is performed — so it pins
// the config, not just the wiring the fake-driven finalize tests cover.

import { expect, test } from "bun:test";

import { createRumdl } from "@/tasks/release/rumdl.ts";

// The reflow shells out to `mise x rumdl`, whose cold start can take a moment on
// a busy machine; give it the same generous budget the CLI subprocess tests use.
const RUMDL_TIMEOUT_MS = 30_000;

test(
  "reflow collapses a hard-wrapped paragraph to a single line",
  async () => {
    const input = "This is a paragraph that\nis hard wrapped across\nseveral short lines.\n";
    const out = await createRumdl().reflow(input);
    expect(out).toContain("This is a paragraph that is hard wrapped across several short lines.");
  },
  RUMDL_TIMEOUT_MS,
);

test(
  "reflow keeps distinct paragraphs and list items apart",
  async () => {
    const input = "### Added\n\n- A thing\n  that wrapped.\n\nAnother paragraph\nhere.\n";
    const out = await createRumdl().reflow(input);
    expect(out).toContain("### Added");
    expect(out).toContain("- A thing that wrapped.");
    expect(out).toContain("Another paragraph here.");
  },
  RUMDL_TIMEOUT_MS,
);
