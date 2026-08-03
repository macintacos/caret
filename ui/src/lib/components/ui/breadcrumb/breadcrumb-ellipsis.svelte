<script lang="ts">
	// caret vendors icons rather than depending on @lucide/svelte (EXC-754 parent
	// decision). The stock component imported `@lucide/svelte/icons/more-horizontal`
	// here; that glyph is Lucide "ellipsis", already in the vendored registry, so it
	// renders through Icon.svelte. Icon wraps the SVG in a <span>, so the sibling
	// `[&>svg]:size-4` child selector no longer reaches it and the size rides Icon's
	// own prop instead. That rule is now inert — the props are WithoutChildren, so no
	// caller can supply an <svg> either — but it is left as the CLI wrote it so this
	// file stays diffable against a re-run of `shadcn-svelte add breadcrumb`.
	//
	// EXC-957: the marker is a <button>, not the stock inert
	// `<span role="presentation" aria-hidden="true">`. caret's one caller opens the
	// levels the trail had to swallow from this element, and levels reachable only
	// by guessing where they went are exactly what that issue set out to fix — so
	// the marker has to be focusable and named. Callers give it an accessible name;
	// the sr-only text below is the fallback for one that does not.
	import Icon from "@/components/Icon.svelte";
	import { cn, type WithElementRef, type WithoutChildren } from "$lib/utils.js";
	import type { HTMLButtonAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildren<WithElementRef<HTMLButtonAttributes, HTMLButtonElement>> = $props();
</script>

<button
	bind:this={ref}
	type="button"
	data-slot="breadcrumb-ellipsis"
	class={cn("size-5 [&>svg]:size-4 flex items-center justify-center", className)}
	{...restProps}
>
	<Icon name="ellipsis" size={16} />
	<span class="sr-only">More</span>
</button>
