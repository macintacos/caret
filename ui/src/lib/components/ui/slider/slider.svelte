<script lang="ts">
	import { Slider as SliderPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		value = $bindable(),
		orientation = "horizontal",
		class: className,
		// EXC-1101: pulled OUT of restProps so they reach the THUMB instead of the root.
		// bits-ui puts role="slider" and the aria-value* trio on the thumb, and leaves the
		// root a bare <span> with no role at all (SliderBaseRootState.props) — so the
		// registry's `{...restProps}` spread lands both of these on a role-less element,
		// where they name nothing and describe nothing. The thumb merges caller props
		// UNDER its own state props and sets neither, so forwarding them there is a pure
		// addition. Without this the settings volume slider is keyboard-operable but
		// anonymous. Guarded by slider.test.ts — put this back if a re-sync drops it
		// (doc/agents/shadcn-rules.md § Edits a re-sync will silently undo).
		"aria-labelledby": labelledBy,
		"aria-valuetext": valueText,
		...restProps
	}: WithoutChildrenOrChild<SliderPrimitive.RootProps> = $props();
</script>

<!--
Discriminated Unions + Destructing (required for bindable) do not
get along, so we shut typescript up by casting `value` to `never`.
-->
<SliderPrimitive.Root
	bind:ref
	bind:value={value as never}
	data-slot="slider"
	{orientation}
	class={cn(
		"data-[orientation=vertical]:min-h-40 relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
		className
	)}
	{...restProps}
>
	{#snippet children({ thumbItems })}
		<span
			data-slot="slider-track"
			data-orientation={orientation}
			class={cn(
				"rounded-full bg-muted data-[orientation=horizontal]:h-1 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1 relative grow overflow-hidden bg-muted data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full"
			)}
		>
			<SliderPrimitive.Range
				data-slot="slider-range"
				class={cn(
					"bg-primary absolute select-none data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
				)}
			/>
		</span>
		{#each thumbItems as thumb (thumb.index)}
			<SliderPrimitive.Thumb
				data-slot="slider-thumb"
				index={thumb.index}
				aria-labelledby={labelledBy}
				aria-valuetext={valueText}
				class="relative size-3 rounded-full border border-ring bg-background ring-ring/50 transition-[color,box-shadow] after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 block shrink-0 select-none disabled:pointer-events-none disabled:opacity-50"
			/>
		{/each}
	{/snippet}
</SliderPrimitive.Root>
