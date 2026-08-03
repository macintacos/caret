<script lang="ts">
	import { cn } from "$lib/utils.js";
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	// caret vendors icons rather than depending on @lucide/svelte (EXC-754 parent
	// decision). The stock `@lucide/svelte/icons/chevron-right` import is replaced by
	// the vendored glyph through Icon.svelte. The `[&_svg …]` rules below are
	// descendant selectors, so they do reach the <svg> Icon nests inside its wrapper
	// <span>; `size={16}` sizes that wrapper to agree with them rather than fight.
	import Icon from "@/components/Icon.svelte";

	let {
		ref = $bindable(null),
		class: className,
		inset,
		children,
		...restProps
	}: DropdownMenuPrimitive.SubTriggerProps & {
		inset?: boolean;
	} = $props();
</script>

<DropdownMenuPrimitive.SubTrigger
	bind:ref
	data-slot="dropdown-menu-sub-trigger"
	data-inset={inset}
	class={cn(
		// Layout + resting look — matched to dropdown-menu-item so a row that opens a
		// submenu sits flush with the plain rows beside it
		"relative flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-hidden select-none",
		// Leading icon: sizing, no pointer capture, and the default muted tint
		"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
		// Inset rows get leading space so their labels align under icon rows
		"data-inset:ps-8",
		// Disabled row
		"data-disabled:pointer-events-none data-disabled:opacity-50",
		// Highlighted (hover / keyboard) row
		"data-highlighted:bg-accent data-highlighted:text-accent-foreground",
		// While its submenu is open the row stays highlighted, so the trail from the
		// parent menu to the open panel reads unbroken
		"data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<span class="ms-auto flex items-center">
		<Icon name="chevron-right" size={16} />
	</span>
</DropdownMenuPrimitive.SubTrigger>
