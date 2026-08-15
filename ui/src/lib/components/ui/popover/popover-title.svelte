<script lang="ts">
	// Stock also carries a `cn-font-heading` class. Those `cn-*` names are defined only
	// in the registry style's own CSS layer, which caret does not import, so it would be
	// inert here; the heading face already rides caret's --font-sans.
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="popover-title"
	class={cn("font-medium", className)}
	{...restProps}
>
	{@render children?.()}
</div>
