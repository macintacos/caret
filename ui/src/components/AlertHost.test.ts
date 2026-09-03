import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import { capture, render } from "@ui/support/mount.ts";
import AlertHost from "@/components/AlertHost.svelte";
import type { AlertItem } from "@/state/alerts.ts";

const item = (over: Partial<AlertItem> & { id: number }): AlertItem => ({
  variant: "default",
  message: "msg",
  leaving: false,
  ...over,
});

describe("AlertHost", () => {
  test("renders nothing when the queue is empty", () => {
    const { target } = render(AlertHost, { alerts: [], onDismiss: () => {} });
    // Boolean assertion (never `expect(node).toBeNull()` — a live happy-dom node
    // serializes circularly and hangs bun on failure).
    expect(target.querySelector(".alert-item") === null).toBe(true);
  });

  test("renders queued alerts in insertion order with their message + variant", () => {
    const alerts = [
      item({ id: 1, message: "first" }),
      item({ id: 2, variant: "success", message: "second" }),
    ];
    const { target } = render(AlertHost, { alerts, onDismiss: () => {} });
    const messages = [...target.querySelectorAll(".alert-message")].map((e) =>
      e.textContent?.trim(),
    );
    expect(messages).toEqual(["first", "second"]);
    const items = target.querySelectorAll(".alert-item");
    expect(items[0]?.getAttribute("data-variant")).toBe("default");
    expect(items[1]?.getAttribute("data-variant")).toBe("success");
    // Polite, not assertive: role="status" must override Alert.Root's default
    // role="alert" (a confirmation shouldn't interrupt a screen reader).
    expect(items[0]?.getAttribute("role")).toBe("status");
  });

  test("a destructive alert is assertive (role=alert), not polite", () => {
    // A failure the user must act on interrupts the screen reader; success/default
    // confirmations stay polite (role=status).
    const { target } = render(AlertHost, {
      alerts: [item({ id: 9, variant: "destructive", message: "Couldn't save" })],
      onDismiss: () => {},
    });
    expect(target.querySelector(".alert-item")?.getAttribute("role")).toBe("alert");
  });

  test("the dismiss button calls onDismiss with the alert id", () => {
    const dismissed = capture<number>();
    const { target } = render(AlertHost, {
      alerts: [item({ id: 7, message: "x" })],
      onDismiss: dismissed.cb,
    });
    target.querySelector<HTMLButtonElement>(".alert-dismiss")?.click();
    expect(dismissed.last()).toBe(7);
  });

  test("marks a leaving alert so the CSS exit animation runs", () => {
    const { target } = render(AlertHost, {
      alerts: [item({ id: 3, message: "bye", leaving: true })],
      onDismiss: () => {},
    });
    expect(target.querySelector(".alert-item")?.classList.contains("leaving")).toBe(true);
  });
});

describe("AlertHost action (EXC-1207)", () => {
  test("renders the action as a labelled button beside the message", () => {
    const { target } = render(AlertHost, {
      alerts: [
        item({
          id: 4,
          message: "caret 1.2.0 is available",
          action: { label: "Update", run: () => {} },
        }),
      ],
      onDismiss: () => {},
    });
    const btn = target.querySelector<HTMLButtonElement>(".alert-action");
    expect(btn?.textContent?.trim()).toBe("Update");
    // Out of context — a screen reader's button list — "Update" alone says nothing
    // about which alert it acts on, so the message is its description.
    expect(btn?.getAttribute("aria-describedby")).toBe("alert-message-4");
    expect(target.querySelector(".alert-message")?.id).toBe("alert-message-4");
  });

  test("renders no action button when the alert carries none", () => {
    const { target } = render(AlertHost, {
      alerts: [item({ id: 5, message: "no action here" })],
      onDismiss: () => {},
    });
    expect(target.querySelector(".alert-action") === null).toBe(true);
  });

  test("clicking the action button runs it", () => {
    const ran = capture<true>();
    const { target } = render(AlertHost, {
      alerts: [item({ id: 6, message: "x", action: { label: "Update", run: () => ran.cb(true) } })],
      onDismiss: () => {},
    });
    expect(ran.last()).toBeUndefined();
    target.querySelector<HTMLButtonElement>(".alert-action")?.click();
    expect(ran.last()).toBe(true);
  });
});
