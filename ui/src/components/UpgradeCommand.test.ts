import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import { render } from "@ui/support/mount.ts";
import UpgradeCommand from "@/components/UpgradeCommand.svelte";

// Lets a click's async handler settle (the awaited copy + the reactive update).
const settle = () => Promise.resolve().then(() => Promise.resolve());

const COMMAND = "bunx --no-cache @macintacos/caret@latest install --refresh";

describe("UpgradeCommand", () => {
  test("shows the command in a read-only field", () => {
    const { target, flush } = render(UpgradeCommand, { command: COMMAND, copy: async () => {} });
    flush();
    const field = target.querySelector<HTMLInputElement>("[aria-label='Upgrade command']");
    expect(field?.value).toBe(COMMAND);
    expect(field?.readOnly).toBe(true);
  });

  test("copies the command and confirms with a checkmark", async () => {
    let written: string | undefined;
    const copy = (t: string) => {
      written = t;
      return Promise.resolve();
    };
    const { target, flush } = render(UpgradeCommand, { command: COMMAND, copy });
    flush();
    const button = target.querySelector("button") as HTMLButtonElement;
    expect(button.getAttribute("aria-label")).toBe("Copy upgrade command");
    button.click();
    await settle();
    flush();

    expect(written).toBe(COMMAND);
    expect(button.getAttribute("aria-label")).toBe("Copied upgrade command");
  });

  test("stays as the copy button when the clipboard write rejects", async () => {
    const copy = () => Promise.reject(new Error("denied"));
    const { target, flush } = render(UpgradeCommand, { command: COMMAND, copy });
    flush();
    const button = target.querySelector("button") as HTMLButtonElement;
    button.click();
    await settle();
    flush();

    expect(button.getAttribute("aria-label")).toBe("Copy upgrade command");
  });
});
