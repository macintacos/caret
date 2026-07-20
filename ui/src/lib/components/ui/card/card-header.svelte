<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="card-header"
	class={cn(
		// Grid layout
		"@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5",
		// Spacing
		"px-6 [.border-b]:pb-6",
		// Card-action column
		"has-data-[slot=card-action]:grid-cols-[1fr_auto]",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
