<script lang="ts">
	import { Select as SelectPrimitive } from "bits-ui";
	// caret vendors icons rather than depending on @lucide/svelte (EXC-754 parent
	// decision). The stock `@lucide/svelte/icons/chevron-down` import is replaced by the
	// vendored glyph through Icon.svelte; the button is already the flex wrapper, so
	// Icon needs no <span> of its own here.
	import Icon from "@/components/Icon.svelte";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildrenOrChild<SelectPrimitive.ScrollDownButtonProps> = $props();
</script>

<SelectPrimitive.ScrollDownButton
	bind:ref
	data-slot="select-scroll-down-button"
	class={cn("z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4 bottom-0 w-full", className)}
	{...restProps}
>
	<Icon name="chevron-down" size={16} />
</SelectPrimitive.ScrollDownButton>
