<script lang="ts">
	import { Select as SelectPrimitive } from "bits-ui";
	// caret vendors icons rather than depending on @lucide/svelte (EXC-754 parent
	// decision). The stock `@lucide/svelte/icons/check` import is replaced by the
	// vendored glyph through Icon.svelte; the indicator's own <span> is already the
	// wrapper Icon needs, so no extra element is introduced.
	import Icon from "@/components/Icon.svelte";
	import { cn, type WithoutChild } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		value,
		label,
		children: childrenProp,
		...restProps
	}: WithoutChild<SelectPrimitive.ItemProps> = $props();
</script>

<SelectPrimitive.Item
	bind:ref
	{value}
	data-slot="select-item"
	class={cn(
		// Radius and cursor are matched to dropdown-menu-item / command-item so a Select
		// row reads as the same control as the menu row it stands beside — stock ships
		// rounded-md + cursor-default (doc/agents/shadcn-rules.md § The caret surface
		// language). Everything else on this line is registry source.
		"gap-1.5 rounded-lg py-1 pr-8 pl-1.5 text-sm focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2 relative flex w-full cursor-pointer items-center outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		className
	)}
	{...restProps}
>
	{#snippet children({ selected, highlighted })}
		<span class="absolute inset-e-2 flex size-3.5 items-center justify-center">
			{#if selected}
				<Icon name="check" size={16} />
			{/if}
		</span>
		<span class="flex flex-1 gap-2 shrink-0 whitespace-nowrap">
			{#if childrenProp}
				{@render childrenProp({ selected, highlighted })}
			{:else}
				{label || value}
			{/if}
		</span>
	{/snippet}
</SelectPrimitive.Item>
