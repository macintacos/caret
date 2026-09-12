// The per-platform surface names every install message is built from. The plumbing is
// covered where the messages are assembled; what is pinned here are the values, which is
// where EXC-1262 lived: darwin naming the Login Items switch as what turned the service
// off, when `status().disabled` cannot read that switch at all.

import { expect, test } from "bun:test";

import { SURFACES } from "@/commands/service-target.ts";

test("darwin names what turned the service off, not the switch caret cannot read", () => {
  expect(SURFACES.darwin.optOutSurface).not.toBe(SURFACES.darwin.visibleIn);
});

test("the caveat is carried only where the visible switch is one caret cannot read", () => {
  expect(SURFACES.darwin.visibleToggleCaveat).toBeDefined();
  expect(SURFACES.linux.visibleToggleCaveat).toBeUndefined();
});
