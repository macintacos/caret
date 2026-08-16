<script lang="ts">
	// caret vendors icons rather than depending on @lucide/svelte (EXC-754 parent
	// decision). This component IS its glyph, so the swap re-shapes it rather than
	// wrapping it: the stock `@lucide/svelte/icons/loader-2` component is replaced by
	// the vendored `loader-circle` (lucide renamed loader-2 to loader-circle; the
	// @lucide/svelte path is an alias for it) rendered through Icon.svelte, and the
	// props move from SVG attributes to a plain <span>'s. `size` is forwarded to Icon
	// because Icon writes its dimensions inline and would ignore a `size-*` utility in
	// `class`, so a caller asking for a bigger spinner has to say so here.
	//
	// data-slot and the bindable `ref` are caret additions — stock has neither, because
	// stock forwards to a lucide component rather than owning a node. Every other
	// component in the vendored tree exposes both, and spinner.test.ts asserts through
	// the slot.
	//
	// The spin obeys the app-wide reduced-motion guard in styles/base.css, which clamps
	// every animation under `prefers-reduced-motion: reduce`. `role="status"` names the
	// region for assistive tech, but note it does NOT reliably announce on its own: a
	// live region is narrated when its CONTENT changes, and this one is created already
	// populated with an aria-hidden glyph. A surface that needs the wait spoken should
	// render the region before the state flips rather than rely on this component.
	import Icon from "@/components/Icon.svelte";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		role = "status",
		size = 16,
		"aria-label": ariaLabel = "Loading",
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLSpanElement>> & { size?: number } = $props();
</script>

<span
	bind:this={ref}
	data-slot="spinner"
	{role}
	aria-label={ariaLabel}
	class={cn("inline-flex animate-spin", className)}
	{...restProps}
>
	<Icon name="loader-circle" {size} />
</span>
