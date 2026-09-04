// Shared mount harness for the component suite. Mounts a Svelte 5 component into
// a detached target under happy-dom (DOM globals registered by setup.ts,
// client-side compilation wired by svelte-preload.ts), exposes the host
// element for queries, and tracks live instances so afterEach can unmount them.
// Imported as @ui/support/mount.ts by the component tests.
import "./setup.ts";
import { afterEach } from "bun:test";

import { type Component, flushSync, mount, unmount } from "svelte";

import { assertSvelteClientRuntime } from "./svelte-runtime-guard.ts";

// Guard the bare-invocation footgun before any component mounts: only this
// module imports the harness, and the backend suite never touches it, so the
// check stays inert there under any invocation. `import.meta.resolve` reports
// the exact svelte module the active export conditions picked — see
// svelte-runtime-guard.ts for why a missing `browser` condition crashes mounts.
assertSvelteClientRuntime(import.meta.resolve("svelte"));

interface Mounted {
  /** The container the component was mounted into. */
  target: HTMLElement;
  /** Force the pending reactive effects to run synchronously (for assertions
   * that depend on a just-set prop or a derived value). */
  flush: () => void;
}

const live: Array<{ instance: Record<string, unknown>; target: HTMLElement }> = [];

// bits-ui teleports its overlay/content (Dialog, AlertDialog, Select) straight
// into document.body — outside the render target — and its portal "presence"
// waits for an animationend that never fires under happy-dom, so those nodes
// never self-remove on unmount. Left alone they accumulate, and a later
// `document.body.querySelector("[data-slot=…]")` picks up a stale portal from an
// earlier test. Snapshot the body's pre-test children once, so purgeLeakedNodes can
// drop anything a test added. It runs at the START of every render — not just
// afterEach — because a top-level afterEach in this import-cached module only fires
// for the first file that imported it.
const initialBodyChildren = new Set<Element>(document.body.children);
function purgeLeakedNodes(): void {
  for (const child of [...document.body.children]) {
    if (!initialBodyChildren.has(child)) child.remove();
  }
}

/** Mounts `component` with `props`, returning its container + a flush helper.
 * The two type params mirror svelte's own mount() so Props infers from the
 * component (a missing or mistyped prop is a type error at the call site);
 * Exports/Bindings are irrelevant to mounting and left open. `any` rather than
 * `unknown` is load-bearing here — Component is contravariant in Props, so the
 * `unknown` form would reject every concrete component. */
export function render<
  // biome-ignore lint/suspicious/noExplicitAny: Props constraint, see above.
  Props extends Record<string, any>,
  // biome-ignore lint/suspicious/noExplicitAny: Exports left open, see above.
  Exports extends Record<string, any>,
>(
  // biome-ignore lint/suspicious/noExplicitAny: Bindings left open, see above.
  component: Component<Props, Exports, any>,
  props: Props,
): Mounted {
  purgeLeakedNodes();
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(component, { target, props }) as Record<string, unknown>;
  live.push({ instance, target });
  return { target, flush: () => flushSync() };
}

afterEach(() => {
  for (const { instance, target } of live.splice(0)) {
    unmount(instance);
    target.remove();
  }
  purgeLeakedNodes();
});

/** Flush pending reactive effects and advance timer ticks until `done()` holds
 * (or `tries` iterations elapse). bits-ui portal/presence surfaces (Dialog,
 * AlertDialog, Select content) mount deferred on a timer, so structure/ARIA
 * assertions must poll rather than sleep a fixed interval — a fixed wait risks
 * flaking on a loaded box.
 *
 * **A test that opens an overlay by CLICKING must flush once after `render()` and
 * before the click**, or the content never appears however long this polls.
 * bits-ui's `PresenceManager` seeds `shouldRender` from `open` in its constructor and
 * then watches it, but the watch deliberately swallows its own first run
 * (`#hasMounted`). `render()` does not flush, so a click landing before that first run
 * collapses "false, then true" into a single run — the swallowed one — leaving
 * `shouldRender` stuck at the constructor's `false` for good. Mounting with
 * `open: true` sidesteps it, because the constructor seeds `true` directly. */
export async function flushUntil(
  flush: () => void,
  done: () => boolean,
  tries = 40,
): Promise<void> {
  for (let i = 0; i < tries; i++) {
    flush();
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  flush();
}

/** Records the last value a callback prop was invoked with. Returns the
 * callback to wire into props plus a `last()` reader — the indirection keeps
 * TypeScript from narrowing the captured value to its initial type when the
 * assignment happens inside a callback it can't track. */
export function capture<T>(): { cb: (value: T) => void; last: () => T | undefined } {
  let value: T | undefined;
  return {
    cb: (v) => {
      value = v;
    },
    last: () => value,
  };
}
