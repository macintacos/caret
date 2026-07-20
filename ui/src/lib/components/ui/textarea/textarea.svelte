<script lang="ts">
	import { cn, type WithElementRef, type WithoutChildren } from "$lib/utils.js";
	import type { HTMLTextareaAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		"data-slot": dataSlot = "textarea",
		...restProps
	}: WithoutChildren<WithElementRef<HTMLTextareaAttributes>> = $props();
</script>

<textarea
	bind:this={ref}
	data-slot={dataSlot}
	class={cn(
		// Layout + sizing
		"flex field-sizing-content min-h-16 w-full",
		// Shape + surface
		"rounded-md border bg-transparent dark:bg-input/30 shadow-xs",
		// Spacing + type
		"px-3 py-2 text-base md:text-sm",
		// Border, placeholder + motion
		"border-input placeholder:text-muted-foreground transition-[color,box-shadow] outline-none",
		// Focus ring
		"focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
		// Invalid state
		"aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
		// Disabled
		"disabled:cursor-not-allowed disabled:opacity-50",
		className
	)}
	bind:value
	{...restProps}
></textarea>
