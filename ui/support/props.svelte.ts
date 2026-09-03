// Reactive prop bag for the component suite. Svelte 5's mount() keeps props
// reactive only when given a $state object, so tests that drive prop updates
// after mounting create their props here and assign to the returned proxy's
// fields (then flush via the harness's flush()). Compiled to client output by
// ui/support/svelte-preload.ts's `.svelte.ts` branch; imported as
// @ui/support/props.svelte.ts by the component tests.
export function reactiveProps<T extends Record<string, unknown>>(initial: T): T {
  const props = $state(initial);
  return props;
}
