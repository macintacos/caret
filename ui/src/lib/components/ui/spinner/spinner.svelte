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
	// data-slot is a caret addition — stock stamps none, every other vendored
	// component does, and spinner.test.ts asserts through it.
	//
	// The spin obeys the app-wide reduced-motion guard in styles/base.css, which
	// clamps every animation under `prefers-reduced-motion: reduce`; the role/label
	// pair below is what still announces the wait when it does.
	import Icon from "@/components/Icon.svelte";
	import { cn } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		class: className,
		role = "status",
		size = 16,
		"aria-label": ariaLabel = "Loading",
		...restProps
	}: HTMLAttributes<HTMLSpanElement> & { size?: number } = $props();
</script>

<span
	data-slot="spinner"
	{role}
	aria-label={ariaLabel}
	class={cn("inline-flex animate-spin", className)}
	{...restProps}
>
	<Icon name="loader-circle" {size} />
</span>
