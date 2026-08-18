<script lang="ts">
	// caret vendors icons rather than depending on @lucide/svelte (EXC-754 parent
	// decision). The stock `@lucide/svelte/icons/chevron-right` import is replaced by
	// the vendored glyph through Icon.svelte. Icon wraps the SVG in a <span>, which
	// the sibling `[&>svg]:size-3.5` rule can no longer reach, so the size rides
	// Icon's own prop — the rule is kept for a caller who supplies their own <svg>.
	//
	// EXC-1123 adds the `child` escape hatch, for the reason breadcrumb-item.svelte
	// records: a separator travels in and out with the crumb it punctuates, and only a
	// <li> written in the caller's own template can carry the `out:` directive that
	// animates it. A caller taking the hatch supplies the glyph too, exactly as the
	// default arm below does, and a re-sync reverting it reds PlanBreadcrumbs.test.ts for
	// the reason recorded there.
	import Icon from "@/components/Icon.svelte";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { Snippet } from "svelte";
	import type { HTMLLiAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		child,
		children,
		...restProps
	}: WithElementRef<HTMLLiAttributes> & {
		child?: Snippet<[{ props: HTMLLiAttributes }]>;
	} = $props();

	// Annotated, unlike breadcrumb-item's: `role` and `aria-hidden` are literal unions in
	// HTMLLiAttributes, and an unannotated object literal widens both to `string`.
	const attrs: HTMLLiAttributes = $derived({
		"data-slot": "breadcrumb-separator",
		role: "presentation",
		"aria-hidden": "true",
		class: cn("[&>svg]:size-3.5", className),
		...restProps,
	});
</script>

{#if child}
	{@render child({ props: attrs })}
{:else}
	<li bind:this={ref} {...attrs}>
		{#if children}
			{@render children?.()}
		{:else}
			<Icon name="chevron-right" size={14} />
		{/if}
	</li>
{/if}
