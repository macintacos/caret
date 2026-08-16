<script lang="ts">
	import { Popover as PopoverPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import PopoverPortal from "./popover-portal.svelte";
	import type { ComponentProps } from "svelte";

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 4,
		align = "center",
		portalProps,
		...restProps
	}: PopoverPrimitive.ContentProps & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof PopoverPortal>>;
	} = $props();
</script>

<PopoverPortal {...portalProps}>
	<PopoverPrimitive.Content
		bind:ref
		data-slot="popover-content"
		{sideOffset}
		{align}
		class={cn(
			// Surface + ring — a floating panel takes a soft ring rather than a border
			"bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10",
			// Position + box
			"z-50 flex w-72 flex-col gap-2.5 rounded-lg p-2.5 text-sm outline-hidden",
			// The zoom grows from the trigger edge, so it needs the transform origin
			// bits-ui actually publishes. Stock names a bare `--transform-origin`, which
			// nothing sets — the real one is prefixed per component (`component: "popover"`
			// in bits-ui's popover.svelte.js), exactly as dropdown-menu-content.svelte
			// already spells its own.
			"origin-(--bits-popover-content-transform-origin)",
			// Open / close animation. Keyed on data-[state=…], the attribute bits-ui
			// actually emits — a bare `data-open:` compiles to an [data-open] presence
			// selector that nothing ever sets, so the whole set is dead (EXC-891). The
			// dialog copies already spell it this way; a `shadcn add --overwrite` would
			// restore the broken form.
			"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-100",
			// Directional slide-in
			"data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2",
			className
		)}
		{...restProps}
	/>
</PopoverPortal>
