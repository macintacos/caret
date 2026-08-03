<script lang="ts">
	import { cn } from "$lib/utils.js";
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: DropdownMenuPrimitive.SubContentProps = $props();
</script>

<DropdownMenuPrimitive.SubContent
	bind:ref
	data-slot="dropdown-menu-sub-content"
	class={cn(
		// Surface — the same popover panel as dropdown-menu-content, so a submenu is
		// indistinguishable from the menu that spawned it
		"bg-popover text-popover-foreground",
		// Sizing + layout
		"z-50 max-h-(--bits-dropdown-menu-content-available-height) min-w-32 origin-(--bits-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto",
		// Shape
		"rounded-xl border p-1 shadow-md outline-none",
		// Open / close animation
		"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
		// Directional slide-in
		"data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-end-2 data-[side=right]:slide-in-from-start-2 data-[side=top]:slide-in-from-bottom-2",
		className
	)}
	{...restProps}
/>
