<script lang="ts">
	// EXC-1123 adds the `child` escape hatch the registry ships on breadcrumb-link but not
	// here. A Svelte `out:` directive attaches only to a DOM node written in a template, so
	// a caller handed nothing but this component cannot animate the <li> leaving — and
	// PlanBreadcrumbs, the tree's only consumer, animates a level out of the trail. Molding
	// the copy is the shadcn norm; a hand-rolled look-alike at the call site would also
	// author Tailwind utilities outside app.css's `@source`, where they may not be emitted.
	// A re-sync that reverts this needs no guard of its own: `child` would land in
	// restProps with `children` left undefined, so every crumb renders as an empty <li>
	// and most of PlanBreadcrumbs.test.ts reds on the spot.
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { Snippet } from "svelte";
	import type { HTMLLiAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		child,
		children,
		...restProps
	}: WithElementRef<HTMLLiAttributes> & {
		child?: Snippet<[{ props: HTMLLiAttributes }]>;
	} = $props();

	const attrs = $derived({
		"data-slot": "breadcrumb-item",
		class: cn("gap-1 inline-flex items-center", className),
		...restProps,
	});
</script>

{#if child}
	{@render child({ props: attrs })}
{:else}
	<li bind:this={ref} {...attrs}>
		{@render children?.()}
	</li>
{/if}
