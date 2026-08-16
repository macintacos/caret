// Composition guard for the vendored Field tree and the Label tree it pulls in
// (EXC-1109). Field is meaningless alone, so it takes a fixture plus this suite
// rather than a file beside the component, per doc/agents/shadcn-rules.md § Where
// the test goes. Field is not portalled — it mounts into the render target, like
// Switch and unlike Select.
//
// The load-bearing assertion is `tagName === "LABEL"`. Field's whole point for
// EXC-1112 is that a settings row finally gets a real <label> rather than a styled
// div, and that only holds while `field-label.svelte` renders the pulled-in `label`
// tree. (A re-sync dropping the registry dependency outright fails the import and
// reds this whole file; a re-sync that swaps what field-label renders would not,
// which is the case this assertion covers.) Nothing composes Field yet, so this
// suite is its only consumer.
import "@ui/test-mount.ts";

import { expect, test } from "bun:test";

import { flushUntil, render } from "@ui/test-mount.ts";
import FieldFixture from "$lib/shadcn-field-fixture.svelte";

const field = (target: HTMLElement) => target.querySelector("[data-slot='field']");

test("the field renders as a group holding its label, control and description", async () => {
  const { target, flush } = render(FieldFixture, {});
  await flushUntil(flush, () => field(target) !== null);

  expect(field(target)?.getAttribute("role")).toBe("group");
  expect(field(target)?.getAttribute("data-orientation")).toBe("vertical");
  expect(field(target)?.querySelector("[data-slot='field-label']")?.textContent?.trim()).toBe(
    "Display name",
  );
  expect(field(target)?.querySelector("[data-slot='field-description']")?.textContent?.trim()).toBe(
    "Shown beside your comments.",
  );
});

test("the description is a paragraph, not a styled div", async () => {
  const { target, flush } = render(FieldFixture, {});
  await flushUntil(flush, () => field(target) !== null);

  expect(field(target)?.querySelector("[data-slot='field-description']")?.tagName).toBe("P");
});

test("the field label is a real <label> bound to the control", async () => {
  const { target, flush } = render(FieldFixture, {});
  await flushUntil(flush, () => field(target) !== null);

  const label = field(target)?.querySelector("[data-slot='field-label']");
  expect(label?.tagName).toBe("LABEL");

  const control = field(target)?.querySelector("input");
  expect(control?.id).toBeTruthy();
  expect(label?.getAttribute("for")).toBe(control?.id ?? "");
});
