// Shared mount harness for the component suite. Mounts a Svelte 5 component into
// a detached target under happy-dom (DOM globals registered by test-setup.ts,
// client-side compilation wired by test-svelte-preload.ts), exposes the host
// element for queries, and tracks live instances so afterEach can unmount them.
// Imported as ../../test-mount.ts by the component tests.
import "./test-setup.ts";
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
});

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
