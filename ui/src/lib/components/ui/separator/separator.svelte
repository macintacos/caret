<script lang="ts">
	import { Separator as SeparatorPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		"data-slot": dataSlot = "separator",
		// bits-ui defaults to false, which announces every chrome divider.
		decorative = true,
		...restProps
	}: SeparatorPrimitive.RootProps = $props();
</script>

<SeparatorPrimitive.Root
	bind:ref
	data-slot={dataSlot}
	{decorative}
	class={cn(
		// Surface
		"bg-border shrink-0",
		// Horizontal orientation
		"data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full",
		// Vertical orientation
		"data-[orientation=vertical]:min-h-full data-[orientation=vertical]:w-px",
		className
	)}
	{...restProps}
/>

