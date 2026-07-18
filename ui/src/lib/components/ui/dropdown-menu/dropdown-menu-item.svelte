<script lang="ts">
	import { cn } from "$lib/utils.js";
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";

	let {
		ref = $bindable(null),
		class: className,
		inset,
		variant = "default",
		...restProps
	}: DropdownMenuPrimitive.ItemProps & {
		inset?: boolean;
		variant?: "default" | "destructive";
	} = $props();
</script>

<DropdownMenuPrimitive.Item
	bind:ref
	data-slot="dropdown-menu-item"
	data-inset={inset}
	data-variant={variant}
	class={cn(
		// Layout + resting look
		"relative flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-hidden select-none",
		// Leading icon: sizing, no pointer capture, and the default muted tint
		"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
		// Inset rows get leading space so their labels align under icon rows
		"data-[inset]:ps-8",
		// Highlighted (hover / keyboard) row
		"data-highlighted:bg-accent data-highlighted:text-accent-foreground",
		// Disabled row
		"data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
		// Destructive variant: red label + glyph, red-tinted highlight
		"data-[variant=destructive]:text-destructive data-[variant=destructive]:data-highlighted:text-destructive data-[variant=destructive]:data-highlighted:bg-destructive/10 dark:data-[variant=destructive]:data-highlighted:bg-destructive/20 data-[variant=destructive]:[&_svg]:!text-destructive",
		className
	)}
	{...restProps}
/>

