<script lang="ts">
	// caret vendors icons rather than depending on @lucide/svelte (EXC-754 parent
	// decision). The stock component imported `@lucide/svelte/icons/more-horizontal`
	// here; that glyph is Lucide "ellipsis", already in the vendored registry, so it
	// renders through Icon.svelte. Icon wraps the SVG in a <span>, which the sibling
	// `[&>svg]:size-4` rule can no longer reach, so the size rides Icon's own prop —
	// the rule is kept for a caller who supplies their own <svg>.
	import Icon from "@/components/Icon.svelte";
	import { cn, type WithElementRef, type WithoutChildren } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildren<WithElementRef<HTMLAttributes<HTMLSpanElement>>> = $props();
</script>

<span
	bind:this={ref}
	data-slot="breadcrumb-ellipsis"
	role="presentation"
	aria-hidden="true"
	class={cn("size-5 [&>svg]:size-4 flex items-center justify-center", className)}
	{...restProps}
>
	<Icon name="ellipsis" size={16} />
	<span class="sr-only">More</span>
</span>
