// SettingSlider composes the vendored Slider (EXC-1101). The slider tree's own ARIA
// is pinned by lib/components/ui/slider/slider.test.ts; this suite covers what caret
// puts on top of it — the percent readout, and the coalescing that keeps one
// adjustment from becoming a burst of writes.
//
// Two harness facts matter here:
//
//   * bits-ui Slider is plain (non-portalled) like Switch, so it mounts into the
//     render target and needs no document.body query or portal cleanup.
//   * The thumb moves on `keydown` — `SliderThumbState.onkeydown` is bound to the
//     thumb element itself — so the event is dispatched there, not on the root. A
//     suite that reached for `.click()` out of habit would pass vacuously, since
//     `flushUntil` exhausts its budget without throwing.
//
// The commit window is driven through the injected `schedule`, the same
// injectable-timer discipline state/alerts.ts and lib/safeMode.ts use: nothing here
// waits on a real timer, so the suite is deterministic rather than merely fast.
import "@ui/support/mount.ts";

import { describe, expect, test } from "bun:test";

import { flushSync, mount, unmount } from "svelte";

import { capture, flushUntil, render } from "@ui/support/mount.ts";
import SettingSlider from "@/components/SettingSlider.svelte";

const thumb = (target: HTMLElement) =>
  target.querySelector("[data-slot='slider-thumb']") as HTMLElement | null;
const readout = (target: HTMLElement) => target.querySelector(".readout")?.textContent;

/** A `schedule` that never fires on its own — the test decides when the window
 * closes, by calling the returned `fire`. Mirrors AlertDeps.schedule's shape. */
function manualSchedule() {
  let pending: (() => void) | undefined;
  let cancels = 0;
  return {
    schedule: (fn: () => void) => {
      pending = fn;
      return () => {
        pending = undefined;
        cancels++;
      };
    },
    fire: () => {
      const fn = pending;
      pending = undefined;
      fn?.();
    },
    cancels: () => cancels,
  };
}

function press(el: HTMLElement, key: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("SettingSlider", () => {
  test("shows the value as a percent, on the thumb and in the readout", async () => {
    const { target, flush } = render(SettingSlider, {
      value: 40,
      onSelect: () => {},
      labelledBy: "setting-soundVolume-label",
    });
    await flushUntil(flush, () => thumb(target) !== null);

    expect(thumb(target)?.getAttribute("aria-valuenow")).toBe("40");
    expect(thumb(target)?.getAttribute("aria-valuetext")).toBe("40%");
    expect(thumb(target)?.getAttribute("aria-labelledby")).toBe("setting-soundVolume-label");
    expect(readout(target)).toBe("40%");
  });

  test("the readout is hidden from the reader — aria-valuetext already says it", async () => {
    const { target, flush } = render(SettingSlider, {
      value: 40,
      onSelect: () => {},
      labelledBy: "x",
    });
    await flushUntil(flush, () => thumb(target) !== null);
    expect(target.querySelector(".readout")?.getAttribute("aria-hidden")).toBe("true");
  });

  test("an arrow key moves the thumb but does not write yet", async () => {
    const picked = capture<number>();
    const timer = manualSchedule();
    const { target, flush } = render(SettingSlider, {
      value: 40,
      onSelect: picked.cb,
      labelledBy: "x",
      schedule: timer.schedule,
    });
    await flushUntil(flush, () => thumb(target) !== null);

    press(thumb(target) as HTMLElement, "ArrowRight");
    flush();

    expect(thumb(target)?.getAttribute("aria-valuenow")).toBe("45");
    expect(readout(target)).toBe("45%");
    expect(picked.last()).toBeUndefined();
  });

  test("a burst of arrow keys writes exactly once, at the final value", async () => {
    let calls = 0;
    let last: number | undefined;
    const timer = manualSchedule();
    const { target, flush } = render(SettingSlider, {
      value: 40,
      onSelect: (v: number) => {
        calls++;
        last = v;
      },
      labelledBy: "x",
      schedule: timer.schedule,
    });
    await flushUntil(flush, () => thumb(target) !== null);

    // bits-ui fires its own commit on EVERY arrow keydown, so without coalescing
    // this is four writes — four toasts and four chimes at rising volume.
    for (let i = 0; i < 4; i++) {
      press(thumb(target) as HTMLElement, "ArrowRight");
      flush();
    }
    expect(calls).toBe(0);
    expect(timer.cancels()).toBe(3); // each keypress restarted the window

    timer.fire();
    flush();
    expect(calls).toBe(1);
    expect(last).toBe(60);
  });

  test("a pending write is flushed when the row goes away", () => {
    // Switching settings category or pressing Escape destroys this component, and a
    // preference the reviewer set that silently never lands is data loss. Mounted
    // directly rather than through render() because the flush is observed at unmount,
    // which the shared harness performs in afterEach — after the assertions.
    let last: number | undefined;
    const timer = manualSchedule();
    const target = document.createElement("div");
    document.body.appendChild(target);
    const instance = mount(SettingSlider, {
      target,
      props: {
        value: 40,
        onSelect: (v: number) => {
          last = v;
        },
        labelledBy: "x",
        schedule: timer.schedule,
      },
    });
    flushSync();

    press(thumb(target) as HTMLElement, "ArrowRight");
    flushSync();
    expect(last).toBeUndefined();

    unmount(instance);
    flushSync();
    expect(last).toBe(45);
    target.remove();
  });

  test("returning to the value it started on writes nothing", async () => {
    let calls = 0;
    const timer = manualSchedule();
    const { target, flush } = render(SettingSlider, {
      value: 40,
      onSelect: () => {
        calls++;
      },
      labelledBy: "x",
      schedule: timer.schedule,
    });
    await flushUntil(flush, () => thumb(target) !== null);

    press(thumb(target) as HTMLElement, "ArrowRight");
    flush();
    press(thumb(target) as HTMLElement, "ArrowLeft");
    flush();
    timer.fire();
    flush();

    expect(calls).toBe(0);
    expect(readout(target)).toBe("40%");
  });

  test("reaches both ends of the range", async () => {
    let last: number | undefined;
    const timer = manualSchedule();
    const { target, flush } = render(SettingSlider, {
      value: 40,
      onSelect: (v: number) => {
        last = v;
      },
      labelledBy: "x",
      schedule: timer.schedule,
    });
    await flushUntil(flush, () => thumb(target) !== null);

    // Silence is a real setting, and 0 is falsy — a `||` on this path would swallow it.
    press(thumb(target) as HTMLElement, "Home");
    flush();
    timer.fire();
    expect(last).toBe(0);
    expect(readout(target)).toBe("0%");

    press(thumb(target) as HTMLElement, "End");
    flush();
    timer.fire();
    expect(last).toBe(100);
  });
});
