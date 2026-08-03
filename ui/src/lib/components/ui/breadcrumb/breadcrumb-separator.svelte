<script lang="ts">
	// caret vendors icons rather than depending on @lucide/svelte (EXC-754 parent
	// decision). The stock `@lucide/svelte/icons/chevron-right` import is replaced by
	// the vendored glyph through Icon.svelte. Icon wraps the SVG in a <span>, which
	// the sibling `[&>svg]:size-3.5` rule can no longer reach, so the size rides
	// Icon's own prop — the rule is kept for a caller who supplies their own <svg>.
	import Icon from "@/components/Icon.svelte";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLLiAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLLiAttributes> = $props();
</script>

<li
	bind:this={ref}
	data-slot="breadcrumb-separator"
	role="presentation"
	aria-hidden="true"
	class={cn("[&>svg]:size-3.5", className)}
	{...restProps}
>
	{#if children}
		{@render children?.()}
	{:else}
		<Icon name="chevron-right" size={14} />
	{/if}
</li>
