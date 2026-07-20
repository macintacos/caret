<script lang="ts">
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLElement>> = $props();
</script>

<kbd
	bind:this={ref}
	data-slot="kbd"
	class={cn(
		// Layout
		"pointer-events-none w-fit select-none",
		// Leading icon
		"[&_svg:not([class*='size-'])]:size-3",
		// Inside a tooltip
		"in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</kbd>
