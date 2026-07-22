<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	// caret vendors icons rather than depending on @lucide/svelte (EXC-754); the
	// stock `@lucide/svelte/icons/panel-left` import is replaced by the inlined
	// Lucide "panel-left" glyph below, so this tree adds no icon runtime dependency.
	import { cn } from "$lib/utils.js";
	import type { ComponentProps } from "svelte";
	import { useSidebar } from "./context.svelte.js";

	let {
		ref = $bindable(null),
		class: className,
		onclick,
		...restProps
	}: ComponentProps<typeof Button> & {
		onclick?: (e: MouseEvent) => void;
	} = $props();

	const sidebar = useSidebar();
</script>

<Button
	bind:ref
	data-sidebar="trigger"
	data-slot="sidebar-trigger"
	variant="ghost"
	size="icon-sm"
	class={cn("cn-sidebar-trigger", className)}
	type="button"
	onclick={(e) => {
		onclick?.(e);
		sidebar.toggle();
	}}
	{...restProps}
>
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width="24"
		height="24"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<rect width="18" height="18" x="3" y="3" rx="2" />
		<path d="M9 3v18" />
	</svg>
	<span class="sr-only">Toggle Sidebar</span>
</Button>
