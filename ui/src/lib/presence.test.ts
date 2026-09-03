import "@ui/support/setup.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { installUiGoneBeacon, UI_GONE_PATH } from "$lib/presence.ts";

let target: EventTarget;
let teardowns: Array<() => void>;

beforeEach(() => {
  target = new EventTarget();
  teardowns = [];
});
afterEach(() => {
  for (const t of teardowns) t();
});

function install(sendBeacon: (url: string) => boolean) {
  const teardown = installUiGoneBeacon({ target, sendBeacon });
  teardowns.push(teardown);
  return teardown;
}

describe("installUiGoneBeacon", () => {
  test("pagehide beacons the daemon that this tab is closing", () => {
    const sent: string[] = [];
    install((url) => {
      sent.push(url);
      return true;
    });
    target.dispatchEvent(new Event("pagehide"));
    expect(sent).toEqual([UI_GONE_PATH]);
  });

  test("a bfcache freeze (pagehide with persisted) does not beacon — the tab may resume", () => {
    const sent: string[] = [];
    install((url) => {
      sent.push(url);
      return true;
    });
    const frozen = new Event("pagehide");
    // PageTransitionEvent.persisted = true means the page is being frozen into
    // the bfcache, not torn down — it can be restored and resume polling.
    Object.defineProperty(frozen, "persisted", { value: true });
    target.dispatchEvent(frozen);
    expect(sent).toEqual([]);
  });

  test("the teardown removes the listener so a later pagehide is inert", () => {
    const sent: string[] = [];
    const teardown = install((url) => {
      sent.push(url);
      return true;
    });
    teardown();
    target.dispatchEvent(new Event("pagehide"));
    expect(sent).toEqual([]);
  });
});
